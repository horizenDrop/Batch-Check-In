const playerId = ensurePlayerId();
const state = {
  run: null,
  builds: [],
  arenaType: 'small',
  player: null,
  arenaEntryCost: { small: 20, daily: 80, weekly: 200 }
};

const el = {
  playerLabel: document.getElementById('playerLabel'),
  playerState: document.getElementById('playerState'),
  startRunBtn: document.getElementById('startRunBtn'),
  finishRunBtn: document.getElementById('finishRunBtn'),
  slotInput: document.getElementById('slotInput'),
  runState: document.getElementById('runState'),
  choices: document.getElementById('choices'),
  refreshBuildsBtn: document.getElementById('refreshBuildsBtn'),
  builds: document.getElementById('builds'),
  arenaType: document.getElementById('arenaType'),
  refreshArenaBtn: document.getElementById('refreshArenaBtn'),
  arenaState: document.getElementById('arenaState'),
  refreshBoardBtn: document.getElementById('refreshBoardBtn'),
  leaderboard: document.getElementById('leaderboard'),
  log: document.getElementById('log')
};

el.playerLabel.textContent = `Player ID: ${playerId}`;

el.startRunBtn.addEventListener('click', startRun);
el.finishRunBtn.addEventListener('click', finishRun);
el.refreshBuildsBtn.addEventListener('click', refreshBuilds);
el.refreshArenaBtn.addEventListener('click', refreshArena);
el.refreshBoardBtn.addEventListener('click', refreshLeaderboard);
el.arenaType.addEventListener('change', () => {
  state.arenaType = el.arenaType.value;
  renderBuilds();
  refreshArena();
  refreshLeaderboard();
});

init();

async function init() {
  await refreshPlayer();
  await refreshBuilds();
  await refreshArena();
  await refreshLeaderboard();
}

function ensurePlayerId() {
  const key = 'ba_player_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const generated = `p_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-player-id': playerId,
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({ ok: false, error: 'Invalid JSON response' }));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

async function startRun() {
  try {
    const payload = await api('/api/run/start', { method: 'POST', body: JSON.stringify({}) });
    state.run = payload.run;
    renderRun();
    await refreshPlayer();
    log(`Run started: ${state.run.runId}`);
  } catch (error) {
    log(`Start run failed: ${error.message}`);
  }
}

async function choose(index) {
  try {
    const payload = await api('/api/run/choice', {
      method: 'POST',
      body: JSON.stringify({ choiceIndex: index })
    });
    state.run = payload.run;
    renderRun();
    log(`Choice ${index} applied. Round: ${state.run.round}, HP: ${state.run.hp}`);
  } catch (error) {
    log(`Choice failed: ${error.message}`);
  }
}

async function finishRun() {
  try {
    const slotIndex = Number(el.slotInput.value || 0);
    const payload = await api('/api/run/finish', {
      method: 'POST',
      body: JSON.stringify({ slotIndex })
    });

    log(`Run finished. Build ${payload.build.buildId} saved to slot ${payload.build.slotIndex}.`);
    state.run = null;
    renderRun();
    await refreshPlayer();
    await refreshBuilds();
  } catch (error) {
    log(`Finish run failed: ${error.message}`);
  }
}

async function refreshBuilds() {
  try {
    const payload = await api('/api/builds');
    state.builds = payload.builds;
    renderBuilds();
  } catch (error) {
    log(`Load builds failed: ${error.message}`);
  }
}

async function refreshPlayer() {
  try {
    const payload = await api('/api/player');
    state.player = payload.player;
    state.arenaEntryCost = payload.arenaEntryCost || state.arenaEntryCost;
    if (payload.activeRun) {
      state.run = payload.activeRun;
      renderRun();
    }
    renderPlayer();
  } catch (error) {
    log(`Load player failed: ${error.message}`);
  }
}

async function enterArena(buildId) {
  try {
    const payload = await api('/api/arena/enter', {
      method: 'POST',
      body: JSON.stringify({ buildId, arenaType: state.arenaType })
    });

    log(`Build entered ${state.arenaType}. Entry: ${payload.entry.entryId}`);
    await refreshPlayer();
    await refreshBuilds();
    await refreshArena();
    await refreshLeaderboard();
  } catch (error) {
    log(`Arena enter failed: ${error.message}`);
  }
}

async function refreshArena() {
  try {
    const payload = await api(`/api/arena/state?type=${state.arenaType}`);
    el.arenaState.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    log(`Arena state failed: ${error.message}`);
  }
}

async function refreshLeaderboard() {
  try {
    const payload = await api(`/api/leaderboard?type=${state.arenaType}`);
    const rows = payload.rows || [];
    if (!rows.length) {
      el.leaderboard.innerHTML = '<p>No resolved entries yet.</p>';
      return;
    }

    el.leaderboard.innerHTML = rows
      .slice(0, 20)
      .map((row) => `<div class="buildCard">#${row.rank} ${row.nickname} - score ${row.score}</div>`)
      .join('');
  } catch (error) {
    log(`Leaderboard failed: ${error.message}`);
  }
}

function renderRun() {
  if (!state.run) {
    el.runState.textContent = 'No active run.';
    el.choices.innerHTML = '';
    return;
  }

  el.runState.textContent = JSON.stringify(
    {
      status: state.run.status,
      round: state.run.round,
      hp: state.run.hp,
      power: state.run.power,
      economy: state.run.economy
    },
    null,
    2
  );

  if (!state.run.currentChoices || !state.run.currentChoices.length) {
    el.choices.innerHTML = '<p>No choices available. Finish run.</p>';
    return;
  }

  el.choices.innerHTML = state.run.currentChoices
    .map((choice, index) => {
      const label = `${choice.type.toUpperCase()} | ${choice.item.label} | power +${choice.item.power || 0}`;
      return `<button class="choiceBtn" data-index="${index}">${label}</button>`;
    })
    .join('');

  for (const btn of el.choices.querySelectorAll('button')) {
    btn.addEventListener('click', () => choose(Number(btn.dataset.index)));
  }
}

function renderBuilds() {
  if (!state.builds.length) {
    el.builds.innerHTML = '<p>No builds yet.</p>';
    return;
  }

  el.builds.innerHTML = state.builds
    .map(
      (build) => `
        <div class="buildCard">
          <div><strong>Slot ${build.slotIndex}</strong> | Power: ${build.powerScore}</div>
          <div>Traits: ${build.traits.join(', ') || '-'}</div>
          <div>Units: ${build.units.join(', ') || '-'}</div>
          <div>Status: ${build.locked ? 'Locked in arena' : 'Ready'}</div>
          <div class="row">
            <button ${build.locked ? 'disabled' : ''} data-build-id="${build.buildId}">Enter ${state.arenaType} (${state.arenaEntryCost[state.arenaType] || 20}c)</button>
          </div>
        </div>
      `
    )
    .join('');

  for (const btn of el.builds.querySelectorAll('button[data-build-id]')) {
    btn.addEventListener('click', () => enterArena(btn.dataset.buildId));
  }
}

function renderPlayer() {
  if (!state.player) {
    el.playerState.textContent = 'No player data.';
    return;
  }

  el.playerState.textContent = JSON.stringify(
    {
      nickname: state.player.nickname,
      coins: state.player.currency_soft,
      cups: state.player.cups,
      leaderboardPoints: state.player.leaderboard_points,
      mmr: {
        small: state.player.mmr_small,
        daily: state.player.mmr_daily,
        weekly: state.player.mmr_weekly
      },
      costs: state.arenaEntryCost
    },
    null,
    2
  );
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  el.log.textContent = `${line}\n${el.log.textContent}`.slice(0, 8000);
}
