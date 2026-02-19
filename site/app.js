const playerId = ensurePlayerId();
const canvas = document.getElementById('battlefield');
const ctx = canvas.getContext('2d');

const TOWER_CONFIG = {
  arrow: { label: 'Arrow', cost: 20, range: 120, damage: 14, cooldown: 0.45, color: '#3b82f6' },
  cannon: { label: 'Cannon', cost: 30, range: 90, damage: 28, cooldown: 0.95, color: '#ef4444' },
  frost: { label: 'Frost', cost: 25, range: 105, damage: 10, cooldown: 0.55, slow: 0.65, color: '#06b6d4' }
};

const TOWER_SLOTS = [
  { id: 0, x: 90, y: 95, label: 'Left' },
  { id: 1, x: 180, y: 95, label: 'Mid' },
  { id: 2, x: 270, y: 95, label: 'Right' }
];

const state = {
  screen: 'play',
  selectedTower: 'arrow',
  run: null,
  player: null,
  builds: [],
  arenaType: 'small',
  arenaState: null,
  leaderboardRows: [],
  arenaEntryCost: { small: 20, daily: 80, weekly: 200 },
  td: {
    baseHp: 100,
    gold: 50,
    wave: 0,
    score: 0,
    waveInProgress: false,
    awaitingChoice: false,
    towers: [null, null, null],
    enemies: [],
    bullets: [],
    spawnLeft: 0,
    spawnTimer: 0,
    bossWave: false
  }
};

const el = {
  nav: document.getElementById('nav'),
  playerBar: document.getElementById('playerBar'),
  startRunBtn: document.getElementById('startRunBtn'),
  finishRunBtn: document.getElementById('finishRunBtn'),
  slotInput: document.getElementById('slotInput'),
  objective: document.getElementById('objective'),
  battleStats: document.getElementById('battleStats'),
  choices: document.getElementById('choices'),
  refreshBuildsBtn: document.getElementById('refreshBuildsBtn'),
  builds: document.getElementById('builds'),
  arenaBuilds: document.getElementById('arenaBuilds'),
  arenaType: document.getElementById('arenaType'),
  refreshArenaBtn: document.getElementById('refreshArenaBtn'),
  refreshBoardBtn: document.getElementById('refreshBoardBtn'),
  arenaState: document.getElementById('arenaState'),
  leaderboard: document.getElementById('leaderboard'),
  log: document.getElementById('log'),
  buildLeftBtn: document.getElementById('buildLeftBtn'),
  buildMidBtn: document.getElementById('buildMidBtn'),
  buildRightBtn: document.getElementById('buildRightBtn')
};

let lastFrame = performance.now();
requestAnimationFrame(loop);

init();

function init() {
  bindEvents();
  hydrate();
}

function bindEvents() {
  el.nav.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-screen]');
    if (!button) return;
    setScreen(button.dataset.screen);
  });

  for (const button of document.querySelectorAll('button[data-tower]')) {
    button.addEventListener('click', () => {
      state.selectedTower = button.dataset.tower;
      for (const b of document.querySelectorAll('button[data-tower]')) {
        b.classList.toggle('active', b === button);
      }
    });
  }

  el.startRunBtn.addEventListener('click', startRun);
  el.finishRunBtn.addEventListener('click', finishRun);
  el.refreshBuildsBtn.addEventListener('click', refreshBuilds);
  el.arenaType.addEventListener('change', () => {
    state.arenaType = el.arenaType.value;
    refreshArena();
    refreshLeaderboard();
    renderArenaBuilds();
  });
  el.refreshArenaBtn.addEventListener('click', refreshArena);
  el.refreshBoardBtn.addEventListener('click', refreshLeaderboard);

  el.buildLeftBtn.addEventListener('click', () => placeTower(0));
  el.buildMidBtn.addEventListener('click', () => placeTower(1));
  el.buildRightBtn.addEventListener('click', () => placeTower(2));
}

async function hydrate() {
  await refreshPlayer();
  await refreshBuilds();
  await refreshArena();
  await refreshLeaderboard();
  renderEverything();
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

  const payload = await response.json().catch(() => ({ ok: false, error: 'Bad JSON' }));
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
    state.run = payload.activeRun || null;
    if (!state.run) {
      state.td.awaitingChoice = false;
    }
    renderPlayerBar();
  } catch (error) {
    log(`Player load failed: ${error.message}`);
  }
}

async function startRun() {
  try {
    const payload = await api('/api/run/start', { method: 'POST', body: JSON.stringify({}) });
    state.run = payload.run;
    resetTdForRun();
    state.td.awaitingChoice = true;
    setScreen('play');
    renderEverything();
    log('Run started. Pick a card to launch Wave 1.');
  } catch (error) {
    log(`Start failed: ${error.message}`);
  }
}

function resetTdForRun() {
  state.td.baseHp = 100;
  state.td.gold = 50;
  state.td.wave = 0;
  state.td.score = 0;
  state.td.waveInProgress = false;
  state.td.awaitingChoice = false;
  state.td.towers = [null, null, null];
  state.td.enemies = [];
  state.td.bullets = [];
  state.td.spawnLeft = 0;
  state.td.spawnTimer = 0;
  state.td.bossWave = false;
}

async function pickChoice(index) {
  if (!state.run || state.td.waveInProgress || !state.td.awaitingChoice) return;
  try {
    const payload = await api('/api/run/choice', {
      method: 'POST',
      body: JSON.stringify({ choiceIndex: index })
    });
    state.run = payload.run;
    state.td.wave = payload.run.round;
    state.td.awaitingChoice = false;
    startWave(payload.run.round, payload.run.power);
    renderEverything();
    log(`Card picked. Wave ${payload.run.round} started.`);
  } catch (error) {
    log(`Pick failed: ${error.message}`);
  }
}

function startWave(wave, power) {
  state.td.waveInProgress = true;
  state.td.bossWave = wave % 5 === 0;
  const baseCount = 5 + wave;
  state.td.spawnLeft = state.td.bossWave ? Math.max(4, Math.floor(baseCount / 2)) : baseCount;
  state.td.spawnTimer = 0.1;
  state.td.score += power;
}

function placeTower(slotIndex) {
  if (!state.run) {
    log('Start a run first.');
    return;
  }

  if (state.td.towers[slotIndex]) {
    log('Slot already occupied.');
    return;
  }

  const config = TOWER_CONFIG[state.selectedTower];
  if (state.td.gold < config.cost) {
    log(`Not enough gold for ${config.label}.`);
    return;
  }

  const slot = TOWER_SLOTS[slotIndex];
  state.td.gold -= config.cost;
  state.td.towers[slotIndex] = {
    type: state.selectedTower,
    x: slot.x,
    y: slot.y,
    cooldown: 0
  };
  renderEverything();
  log(`Built ${config.label} tower at ${slot.label}.`);
}

async function finishRun() {
  if (!state.run) {
    log('No active run.');
    return;
  }
  if (state.run.status === 'active') {
    log('Run is not finished. Complete waves first.');
    return;
  }

  try {
    const slotIndex = Number(el.slotInput.value || 0);
    const payload = await api('/api/run/finish', {
      method: 'POST',
      body: JSON.stringify({ slotIndex })
    });
    state.run = null;
    state.td.awaitingChoice = false;
    await refreshPlayer();
    await refreshBuilds();
    renderEverything();
    setScreen('builds');
    log(`Build saved in slot ${payload.build.slotIndex}. Power ${payload.build.powerScore}.`);
  } catch (error) {
    log(`Finish failed: ${error.message}`);
  }
}

async function refreshBuilds() {
  try {
    const payload = await api('/api/builds');
    state.builds = payload.builds || [];
    renderBuilds();
    renderArenaBuilds();
  } catch (error) {
    log(`Build load failed: ${error.message}`);
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
    setScreen('arena');
    log(`Entered ${state.arenaType} arena (${payload.entry.entryId.slice(0, 8)}...).`);
  } catch (error) {
    log(`Arena enter failed: ${error.message}`);
  }
}

async function refreshArena() {
  try {
    const payload = await api(`/api/arena/state?type=${state.arenaType}`);
    state.arenaState = payload;
    renderArenaState();
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

function setScreen(screen) {
  state.screen = screen;
  for (const button of document.querySelectorAll('.nav-btn')) {
    button.classList.toggle('active', button.dataset.screen === screen);
  }
  for (const panel of document.querySelectorAll('.screen')) {
    panel.classList.toggle('active', panel.id === `screen-${screen}`);
  }
}

function renderEverything() {
  renderPlayerBar();
  renderBattleStats();
  renderChoices();
  renderBuilds();
  renderArenaBuilds();
}

function renderPlayerBar() {
  if (!state.player) {
    el.playerBar.textContent = `Player ${playerId}`;
    return;
  }

  el.playerBar.textContent = [
    `ID ${playerId}`,
    `Coins ${state.player.currency_soft}`,
    `Cups ${state.player.cups}`,
    `MMR ${state.player.mmr_small}/${state.player.mmr_daily}/${state.player.mmr_weekly}`
  ].join(' | ');
}

function renderBattleStats() {
  const runStatus = state.run ? state.run.status : 'idle';
  el.battleStats.innerHTML = `
    <div class="stat"><b>Status</b><span>${runStatus}</span></div>
    <div class="stat"><b>Wave</b><span>${state.td.wave}/10</span></div>
    <div class="stat"><b>Base HP</b><span>${Math.max(0, Math.round(state.td.baseHp))}</span></div>
    <div class="stat"><b>Gold</b><span>${Math.floor(state.td.gold)}</span></div>
    <div class="stat"><b>Score</b><span>${Math.floor(state.td.score)}</span></div>
  `;

  if (!state.run) {
    el.objective.textContent = 'Press Start Run.';
    return;
  }

  if (state.run.status === 'ready_to_finish' || state.run.status === 'failed') {
    el.objective.textContent = 'Run ended. Press Finish & Save Build.';
    return;
  }

  if (state.td.waveInProgress) {
    el.objective.textContent = `Wave ${state.td.wave} in progress. Defend the path.`;
    return;
  }

  if (state.td.awaitingChoice) {
    el.objective.textContent = 'Pick one upgrade card to start next wave.';
  } else {
    el.objective.textContent = 'Prepare towers.';
  }
}

function renderChoices() {
  if (!state.run) {
    el.choices.innerHTML = '<p class="hint">No run active.</p>';
    return;
  }

  if (!state.run.currentChoices?.length) {
    if (state.run.status === 'active') {
      el.choices.innerHTML = '<p class="hint">Wave running...</p>';
    } else {
      el.choices.innerHTML = '<p class="hint">Run complete. Save your build.</p>';
    }
    return;
  }

  el.choices.innerHTML = state.run.currentChoices
    .map((choice, index) => {
      const bonus = [
        choice.item.power ? `Power +${choice.item.power}` : null,
        choice.item.hp ? `HP +${choice.item.hp}` : null,
        choice.item.economy ? `Economy +${choice.item.economy}` : null
      ]
        .filter(Boolean)
        .join(' | ');
      return `
        <article class="choice-card ${choice.type}">
          <header>${choice.type.toUpperCase()}</header>
          <h3>${choice.item.label}</h3>
          <p>${bonus || 'Utility bonus'}</p>
          <button data-pick="${index}" ${state.td.awaitingChoice ? '' : 'disabled'}>Pick</button>
        </article>
      `;
    })
    .join('');

  for (const button of el.choices.querySelectorAll('button[data-pick]')) {
    button.addEventListener('click', () => pickChoice(Number(button.dataset.pick)));
  }
}

function renderBuilds() {
  if (!state.builds.length) {
    el.builds.innerHTML = '<p class="hint">No builds yet.</p>';
    return;
  }
  el.builds.innerHTML = state.builds.map((b) => buildCardHtml(b, false)).join('');
}

function renderArenaBuilds() {
  const unlocked = state.builds.filter((b) => !b.locked);
  if (!unlocked.length) {
    el.arenaBuilds.innerHTML = '<p class="hint">No unlocked builds.</p>';
    return;
  }
  el.arenaBuilds.innerHTML = unlocked.map((b) => buildCardHtml(b, true)).join('');
  for (const button of el.arenaBuilds.querySelectorAll('button[data-enter]')) {
    button.addEventListener('click', () => enterArena(button.dataset.enter));
  }
}

function buildCardHtml(build, arenaButton) {
  const button = arenaButton
    ? `<button data-enter="${build.buildId}">Enter ${state.arenaType} (${state.arenaEntryCost[state.arenaType]}c)</button>`
    : `<span class="pill ${build.locked ? 'locked' : 'ready'}">${build.locked ? 'LOCKED' : 'READY'}</span>`;
  return `
    <article class="choice-card build">
      <header>Slot ${build.slotIndex}</header>
      <h3>Power ${build.powerScore}</h3>
      <p>Traits: ${(build.traits || []).join(', ') || '-'}</p>
      <p>Units: ${(build.units || []).join(', ') || '-'}</p>
      ${button}
    </article>
  `;
}

function renderArenaState() {
  if (!state.arenaState) {
    el.arenaState.textContent = 'No state.';
    return;
  }
  const mine = state.arenaState.myEntries || [];
  el.arenaState.textContent = [
    `Arena: ${state.arenaType}`,
    `Season: ${state.arenaState.window?.seasonId || '-'}`,
    `Total entries: ${state.arenaState.totalEntries}`,
    `Resolve in: ${state.arenaState.secondsUntilResolve}s`,
    `Your entries: ${mine.length}`
  ].join('\n');
}

function renderLeaderboard() {
  if (!state.leaderboardRows.length) {
    el.leaderboard.innerHTML = '<p class="hint">No resolved rows yet.</p>';
    return;
  }
  el.leaderboard.innerHTML = state.leaderboardRows
    .slice(0, 20)
    .map((row) => `<div class="row-line"><b>#${row.rank}</b> ${row.nickname} <span>${row.score}</span></div>`)
    .join('');
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastFrame) / 1000);
  lastFrame = now;
  updateTd(dt);
  drawTd();
  requestAnimationFrame(loop);
}

function updateTd(dt) {
  const td = state.td;

  if (td.waveInProgress) {
    td.spawnTimer -= dt;
    if (td.spawnLeft > 0 && td.spawnTimer <= 0) {
      spawnEnemy();
      td.spawnLeft -= 1;
      td.spawnTimer = td.bossWave ? 0.9 : 0.55;
    }
  }

  for (const tower of td.towers) {
    if (!tower) continue;
    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;

    const cfg = TOWER_CONFIG[tower.type];
    const target = td.enemies.find((enemy) => distance(tower.x, tower.y, enemy.x, enemy.y) <= cfg.range);
    if (!target) continue;

    tower.cooldown = cfg.cooldown;
    td.bullets.push({
      x: tower.x,
      y: tower.y,
      vx: (target.x - tower.x) * 5.2,
      vy: (target.y - tower.y) * 5.2,
      damage: cfg.damage * damageMultiplier(),
      slow: cfg.slow || 1,
      color: cfg.color,
      life: 0.45
    });
  }

  for (const enemy of td.enemies) {
    const speed = enemy.speed * (enemy.slowLeft > 0 ? enemy.slowFactor : 1);
    enemy.x += speed * dt;
    enemy.slowLeft = Math.max(0, enemy.slowLeft - dt);
  }

  for (const bullet of td.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
  }

  for (const bullet of td.bullets) {
    const hit = td.enemies.find((enemy) => distance(bullet.x, bullet.y, enemy.x, enemy.y) < 10);
    if (!hit) continue;
    hit.hp -= bullet.damage;
    if (bullet.slow < 1) {
      hit.slowFactor = bullet.slow;
      hit.slowLeft = 1.2;
    }
    bullet.life = 0;
  }

  td.bullets = td.bullets.filter((b) => b.life > 0);

  let escaped = 0;
  td.enemies = td.enemies.filter((enemy) => {
    if (enemy.hp <= 0) {
      td.gold += enemy.bounty;
      td.score += enemy.bounty * 2;
      return false;
    }
    if (enemy.x >= 350) {
      escaped += enemy.damage;
      return false;
    }
    return true;
  });

  if (escaped > 0) {
    td.baseHp -= escaped;
    if (state.run) {
      state.run.hp = Math.max(0, state.run.hp - escaped);
    }
  }

  if (td.waveInProgress && td.spawnLeft === 0 && td.enemies.length === 0) {
    td.waveInProgress = false;
    if (!state.run) return;

    if (td.baseHp <= 0) {
      state.run.status = 'failed';
      state.run.currentChoices = [];
      td.awaitingChoice = false;
      log('Base destroyed. Run failed.');
    } else if (state.run.status === 'active') {
      td.awaitingChoice = true;
      log(`Wave ${td.wave} cleared. Pick next card.`);
    } else {
      td.awaitingChoice = false;
      log('Run ended by backend state. Save build.');
    }
    renderEverything();
  }
}

function spawnEnemy() {
  const wave = Math.max(1, state.td.wave);
  const boss = state.td.bossWave;
  state.td.enemies.push({
    x: 10,
    y: 95 + (Math.random() * 22 - 11),
    hp: (boss ? 90 : 38) + wave * (boss ? 15 : 8),
    speed: (boss ? 28 : 42) + wave * 1.8,
    damage: boss ? 10 : 6,
    bounty: boss ? 14 : 6,
    slowFactor: 1,
    slowLeft: 0
  });
}

function damageMultiplier() {
  if (!state.run) return 1;
  return 1 + Math.min(0.8, state.run.power / 100);
}

function drawTd() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#1d1720';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#4b3621';
  ctx.fillRect(0, 80, canvas.width, 32);

  ctx.fillStyle = '#5f9c4b';
  ctx.fillRect(0, 0, canvas.width, 78);
  ctx.fillRect(0, 114, canvas.width, 86);

  ctx.fillStyle = '#d3a862';
  ctx.fillRect(344, 70, 14, 56);

  for (let i = 0; i < TOWER_SLOTS.length; i += 1) {
    const slot = TOWER_SLOTS[i];
    const tower = state.td.towers[i];
    if (!tower) {
      ctx.strokeStyle = '#d4b27f';
      ctx.strokeRect(slot.x - 12, slot.y - 12, 24, 24);
      continue;
    }
    const cfg = TOWER_CONFIG[tower.type];
    ctx.fillStyle = cfg.color;
    ctx.fillRect(slot.x - 10, slot.y - 10, 20, 20);
  }

  for (const enemy of state.td.enemies) {
    ctx.fillStyle = enemy.slowLeft > 0 ? '#67e8f9' : '#fca5a5';
    ctx.fillRect(enemy.x - 8, enemy.y - 8, 16, 16);
  }

  for (const bullet of state.td.bullets) {
    ctx.fillStyle = bullet.color;
    ctx.fillRect(bullet.x - 2, bullet.y - 2, 4, 4);
  }
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.log.textContent = `${line}\n${el.log.textContent}`.slice(0, 9000);
}
