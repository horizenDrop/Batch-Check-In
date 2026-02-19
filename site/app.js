const playerId = ensurePlayerId();
const state = {
  activeView: 'menu',
  run: null,
  builds: [],
  arenaType: 'small',
  player: null,
  arenaState: null,
  leaderboardRows: [],
  arenaEntryCost: { small: 20, daily: 80, weekly: 200 }
};

const el = {
  playerBar: document.getElementById('playerBar'),
  tabs: document.getElementById('tabs'),
  menuStartRunBtn: document.getElementById('menuStartRunBtn'),
  startRunBtn: document.getElementById('startRunBtn'),
  finishRunBtn: document.getElementById('finishRunBtn'),
  slotInput: document.getElementById('slotInput'),
  runSummary: document.getElementById('runSummary'),
  choices: document.getElementById('choices'),
  refreshBuildsBtn: document.getElementById('refreshBuildsBtn'),
  builds: document.getElementById('builds'),
  arenaBuilds: document.getElementById('arenaBuilds'),
  arenaType: document.getElementById('arenaType'),
  refreshArenaBtn: document.getElementById('refreshArenaBtn'),
  arenaState: document.getElementById('arenaState'),
  refreshBoardBtn: document.getElementById('refreshBoardBtn'),
  leaderboard: document.getElementById('leaderboard'),
  log: document.getElementById('log')
};

init();

function init() {
  bindEvents();
  window.addEventListener('resize', renderPlayerBar);
  hydrate();
}

function bindEvents() {
  el.menuStartRunBtn.addEventListener('click', async () => {
    setView('run');
    await startRun();
  });
  el.startRunBtn.addEventListener('click', startRun);
  el.finishRunBtn.addEventListener('click', finishRun);
  el.refreshBuildsBtn.addEventListener('click', refreshBuilds);
  el.refreshArenaBtn.addEventListener('click', refreshArena);
  el.refreshBoardBtn.addEventListener('click', refreshLeaderboard);
  el.arenaType.addEventListener('change', () => {
    state.arenaType = el.arenaType.value;
    renderBuilds();
    renderArenaBuilds();
    refreshArena();
    refreshLeaderboard();
  });

  el.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (!button) return;
    setView(button.dataset.view);
  });

  for (const jump of document.querySelectorAll('[data-view-jump]')) {
    jump.addEventListener('click', () => setView(jump.dataset.viewJump));
  }
}

async function hydrate() {
  await refreshPlayer();
  await refreshBuilds();
  await refreshArena();
  await refreshLeaderboard();
  renderRun();
}

function setView(view) {
  state.activeView = view;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.view === view);
  }

  for (const panel of document.querySelectorAll('.view')) {
    panel.classList.toggle('active', panel.id === `view-${view}`);
  }
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

  const payload = await response.json().catch(() => ({ ok: false, error: 'Bad server JSON' }));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

async function refreshPlayer() {
  try {
    const payload = await api('/api/player');
    state.player = payload.player;
    state.arenaEntryCost = payload.arenaEntryCost || state.arenaEntryCost;
    if (payload.activeRun) state.run = payload.activeRun;
    renderPlayerBar();
  } catch (error) {
    log(`Player load failed: ${error.message}`);
  }
}

async function startRun() {
  try {
    const payload = await api('/api/run/start', { method: 'POST', body: JSON.stringify({}) });
    state.run = payload.run;
    setView('run');
    renderRun();
    log(`Run started. Seed ${state.run.seed.slice(0, 8)}...`);
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
    log(`Round ${state.run.round}: picked card ${index + 1}`);
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

    state.run = null;
    renderRun();
    await refreshPlayer();
    await refreshBuilds();
    setView('builds');
    log(`Build saved to slot ${payload.build.slotIndex}. Power ${payload.build.powerScore}`);
  } catch (error) {
    log(`Finish run failed: ${error.message}`);
  }
}

async function refreshBuilds() {
  try {
    const payload = await api('/api/builds');
    state.builds = payload.builds || [];
    renderBuilds();
    renderArenaBuilds();
  } catch (error) {
    log(`Builds load failed: ${error.message}`);
  }
}

async function enterArena(buildId) {
  try {
    const payload = await api('/api/arena/enter', {
      method: 'POST',
      body: JSON.stringify({ buildId, arenaType: state.arenaType })
    });
    await refreshPlayer();
    await refreshBuilds();
    await refreshArena();
    await refreshLeaderboard();
    setView('arena');
    log(`Build entered ${state.arenaType} arena. Entry ${payload.entry.entryId.slice(0, 8)}...`);
  } catch (error) {
    log(`Arena enter failed: ${error.message}`);
  }
}

async function refreshArena() {
  try {
    const payload = await api(`/api/arena/state?type=${state.arenaType}`);
    state.arenaState = payload;
    renderArena();
  } catch (error) {
    log(`Arena state failed: ${error.message}`);
  }
}

async function refreshLeaderboard() {
  try {
    const payload = await api(`/api/leaderboard?type=${state.arenaType}`);
    state.leaderboardRows = payload.rows || [];
    renderLeaderboard();
  } catch (error) {
    log(`Leaderboard failed: ${error.message}`);
  }
}

function renderPlayerBar() {
  if (!state.player) {
    el.playerBar.textContent = `ID: ${playerId}`;
    return;
  }

  const mobile = window.matchMedia('(max-width: 620px)').matches;
  if (mobile) {
    el.playerBar.textContent = [
      `ID ${playerId}`,
      `Coins ${state.player.currency_soft} | Cups ${state.player.cups}`,
      `MMR ${state.player.mmr_small}/${state.player.mmr_daily}/${state.player.mmr_weekly}`
    ].join('\n');
    return;
  }

  el.playerBar.textContent = [
    `ID ${playerId}`,
    `Coins ${state.player.currency_soft}`,
    `Cups ${state.player.cups}`,
    `MMR S/D/W ${state.player.mmr_small}/${state.player.mmr_daily}/${state.player.mmr_weekly}`
  ].join(' | ');
}

function renderRun() {
  if (!state.run) {
    el.runSummary.innerHTML = `
      <article class="stat-card">
        <h3>No Active Run</h3>
        <p>Start a run to generate choice cards.</p>
      </article>
    `;
    el.choices.innerHTML = '';
    return;
  }

  el.runSummary.innerHTML = `
    <article class="stat-card">
      <h3>Run Status</h3>
      <p>${state.run.status}</p>
    </article>
    <article class="stat-card">
      <h3>Round</h3>
      <p>${state.run.round}/10</p>
    </article>
    <article class="stat-card">
      <h3>HP</h3>
      <p>${state.run.hp}</p>
    </article>
    <article class="stat-card">
      <h3>Power</h3>
      <p>${state.run.power}</p>
    </article>
    <article class="stat-card">
      <h3>Economy</h3>
      <p>${state.run.economy}</p>
    </article>
  `;

  if (!state.run.currentChoices?.length) {
    el.choices.innerHTML = `<p class="lead">No choices left. Use "Finish & Save".</p>`;
    return;
  }

  el.choices.innerHTML = state.run.currentChoices
    .map((choice, index) => cardChoice(choice, index))
    .join('');

  for (const button of el.choices.querySelectorAll('button[data-choice]')) {
    button.addEventListener('click', () => choose(Number(button.dataset.choice)));
  }
}

function cardChoice(choice, index) {
  const typeClass = `type-${choice.type}`;
  const tag = choice.type.toUpperCase();
  const desc = [
    choice.item.power ? `Power +${choice.item.power}` : null,
    choice.item.hp ? `HP +${choice.item.hp}` : null,
    choice.item.economy ? `Economy +${choice.item.economy}` : null
  ]
    .filter(Boolean)
    .join(' | ');

  return `
    <article class="game-card ${typeClass}">
      <header>
        <span class="tag">${tag}</span>
        <span>#${index + 1}</span>
      </header>
      <h3>${choice.item.label}</h3>
      <p>${desc || 'Passive boost'}</p>
      <button data-choice="${index}">Pick Card</button>
    </article>
  `;
}

function renderBuilds() {
  if (!state.builds.length) {
    el.builds.innerHTML = `<p class="lead">No builds yet. Finish a run first.</p>`;
    return;
  }

  el.builds.innerHTML = state.builds.map((build) => buildCard(build, true)).join('');
  attachBuildButtons(el.builds);
}

function renderArenaBuilds() {
  const ready = state.builds.filter((b) => !b.locked);
  if (!ready.length) {
    el.arenaBuilds.innerHTML = `<p class="lead">No unlocked builds. Finish run or wait resolve.</p>`;
    return;
  }
  el.arenaBuilds.innerHTML = ready.map((build) => buildCard(build, false)).join('');
  attachBuildButtons(el.arenaBuilds);
}

function buildCard(build, showSummary) {
  const cost = state.arenaEntryCost[state.arenaType] || 20;
  const lockText = build.locked ? 'LOCKED IN ARENA' : 'READY';
  const button = build.locked
    ? '<button disabled>Locked</button>'
    : `<button data-enter-build="${build.buildId}">Enter ${state.arenaType} (${cost}c)</button>`;

  return `
    <article class="game-card build-card ${build.locked ? 'locked' : 'ready'}">
      <header>
        <span class="tag">SLOT ${build.slotIndex}</span>
        <span>${lockText}</span>
      </header>
      <h3>Power ${build.powerScore}</h3>
      <p>Traits: ${(build.traits || []).join(', ') || '-'}</p>
      <p>Units: ${(build.units || []).join(', ') || '-'}</p>
      ${showSummary ? `<p>Created: ${new Date(build.createdAt).toLocaleString()}</p>` : ''}
      ${button}
    </article>
  `;
}

function attachBuildButtons(container) {
  for (const button of container.querySelectorAll('button[data-enter-build]')) {
    button.addEventListener('click', () => enterArena(button.dataset.enterBuild));
  }
}

function renderArena() {
  if (!state.arenaState) {
    el.arenaState.textContent = 'No arena data';
    return;
  }

  const data = state.arenaState;
  const my = data.myEntries || [];
  const entries = my.length
    ? my.map((entry) => `- ${entry.status} rank:${entry.rank ?? '-'} power:${entry.powerScore}`).join('\n')
    : '- none';

  el.arenaState.textContent = [
    `Arena: ${state.arenaType}`,
    `Season: ${data.window?.seasonId || '-'}`,
    `Total entries: ${data.totalEntries}`,
    `Resolve in: ${data.secondsUntilResolve}s`,
    `Entry cost: ${data.entryCost} coins`,
    'Your entries:',
    entries
  ].join('\n');
}

function renderLeaderboard() {
  if (!state.leaderboardRows.length) {
    el.leaderboard.innerHTML = '<p class="lead">No resolved leaderboard rows yet.</p>';
    return;
  }

  el.leaderboard.innerHTML = state.leaderboardRows
    .slice(0, 30)
    .map(
      (row) => `
        <article class="leader-row">
          <span class="rank">#${row.rank}</span>
          <span class="name">${row.nickname}</span>
          <span class="score">${row.score}</span>
        </article>
      `
    )
    .join('');
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  el.log.textContent = `${line}\n${el.log.textContent}`.slice(0, 9000);
}
