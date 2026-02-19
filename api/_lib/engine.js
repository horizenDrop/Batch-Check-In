const crypto = require('crypto');

const MAX_ROUNDS = 10;
const MAX_SLOTS = 10;
const ARENA_TYPES = ['small', 'daily', 'weekly'];
const ARENA_ENTRY_COST = {
  small: 20,
  daily: 80,
  weekly: 200
};

const TRAITS = [
  { id: 'berserk', label: 'Berserk', power: 7 },
  { id: 'guardian', label: 'Guardian', power: 5 },
  { id: 'arcane', label: 'Arcane', power: 6 },
  { id: 'swift', label: 'Swift', power: 4 },
  { id: 'vampiric', label: 'Vampiric', power: 6 },
  { id: 'fortified', label: 'Fortified', power: 5 }
];

const UNITS = [
  { id: 'orb_knight', label: 'Orb Knight', power: 8 },
  { id: 'ember_mage', label: 'Ember Mage', power: 9 },
  { id: 'void_hunter', label: 'Void Hunter', power: 10 },
  { id: 'crystal_tank', label: 'Crystal Tank', power: 11 },
  { id: 'storm_scout', label: 'Storm Scout', power: 7 }
];

const MODIFIERS = [
  { id: 'hp_boost', label: '+12 HP', hp: 12, power: 2 },
  { id: 'econ_boost', label: '+3 Economy', economy: 3, power: 1 },
  { id: 'crit_core', label: 'Crit Core', power: 5 },
  { id: 'stability', label: 'Stability Matrix', power: 4 }
];

function hashInt(input) {
  const digest = crypto.createHash('sha256').update(String(input)).digest();
  return digest.readUInt32LE(0);
}

function seededRange(seed, salt, max) {
  return hashInt(`${seed}:${salt}`) % max;
}

function choiceByType(type, idx) {
  if (type === 'trait') return TRAITS[idx];
  if (type === 'unit') return UNITS[idx];
  return MODIFIERS[idx];
}

function getRoundChoices(seed, round) {
  const types = ['trait', 'unit', 'modifier'];
  return types.map((type, i) => {
    const pool = type === 'trait' ? TRAITS : type === 'unit' ? UNITS : MODIFIERS;
    const idx = seededRange(seed, `round:${round}:choice:${i}`, pool.length);
    const item = choiceByType(type, idx);
    return {
      choiceId: `${type}:${item.id}`,
      type,
      item
    };
  });
}

function startRun(playerId) {
  const seed = crypto.randomUUID();
  return {
    runId: crypto.randomUUID(),
    playerId,
    seed,
    startedAt: new Date().toISOString(),
    round: 0,
    hp: 100,
    economy: 0,
    power: 12,
    picks: [],
    status: 'active',
    currentChoices: getRoundChoices(seed, 1)
  };
}

function applyChoice(run, choiceIndex) {
  const choice = run.currentChoices[choiceIndex];
  if (!choice) {
    throw new Error('Invalid choice index');
  }

  const updated = { ...run };
  updated.picks = [...updated.picks, choice];

  if (choice.item.power) updated.power += choice.item.power;
  if (choice.item.hp) updated.hp += choice.item.hp;
  if (choice.item.economy) updated.economy += choice.item.economy;

  const currentRound = updated.round + 1;
  const enemyPower = 14 + currentRound * 4 + seededRange(updated.seed, `enemy:${currentRound}`, 8);
  const playerRoll = updated.power + seededRange(updated.seed, `player:${currentRound}`, 6);

  const damage = Math.max(0, Math.floor((enemyPower - playerRoll) / 2));
  updated.hp = Math.max(0, updated.hp - damage);
  updated.round = currentRound;

  if (updated.hp <= 0) {
    updated.status = 'failed';
    updated.currentChoices = [];
    return updated;
  }

  if (updated.round >= MAX_ROUNDS) {
    updated.status = 'ready_to_finish';
    updated.currentChoices = [];
    return updated;
  }

  updated.currentChoices = getRoundChoices(updated.seed, updated.round + 1);
  return updated;
}

function countDupes(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);

  let score = 0;
  for (const count of counts.values()) {
    if (count > 1) score += count - 1;
  }

  return score;
}

function buildSnapshotFromRun(run, slotIndex) {
  const traits = run.picks.filter((p) => p.type === 'trait').map((p) => p.item.id);
  const units = run.picks.filter((p) => p.type === 'unit').map((p) => p.item.id);
  const modifiers = run.picks.filter((p) => p.type === 'modifier').map((p) => p.item.id);

  const traitDupes = countDupes(traits);
  const unitDupes = countDupes(units);
  const synergy = traitDupes * 5 + unitDupes * 6;

  return {
    buildId: crypto.randomUUID(),
    playerId: run.playerId,
    runId: run.runId,
    traits,
    units,
    modifiers,
    powerScore: run.power + run.economy + synergy,
    seed: run.seed,
    slotIndex,
    createdAt: new Date().toISOString(),
    locked: false,
    lockedByArenaEntryId: null
  };
}

function getArenaWindow(arenaType, now = new Date()) {
  const ms = now.getTime();

  if (arenaType === 'small') {
    const windowMs = 15 * 60 * 1000;
    const startMs = Math.floor(ms / windowMs) * windowMs;
    const resultMs = startMs + windowMs;
    return {
      arenaType,
      seasonId: `small:${new Date(startMs).toISOString()}`,
      lockAt: new Date(startMs).toISOString(),
      resultAt: new Date(resultMs).toISOString(),
      windowStartAt: new Date(startMs).toISOString()
    };
  }

  if (arenaType === 'daily') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const result = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return {
      arenaType,
      seasonId: `daily:${start.toISOString().slice(0, 10)}`,
      lockAt: start.toISOString(),
      resultAt: result.toISOString(),
      windowStartAt: start.toISOString()
    };
  }

  if (arenaType === 'weekly') {
    const day = now.getUTCDay();
    const offset = day === 0 ? 6 : day - 1;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - offset);
    const result = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    return {
      arenaType,
      seasonId: `weekly:${start.toISOString().slice(0, 10)}`,
      lockAt: start.toISOString(),
      resultAt: result.toISOString(),
      windowStartAt: start.toISOString()
    };
  }

  throw new Error('Unknown arena type');
}

function rewardForRank(arenaType, rank) {
  const pools = {
    small: [120, 90, 70, 50, 35],
    daily: [500, 350, 250, 150, 80],
    weekly: [2000, 1200, 800, 500, 250]
  };

  const coins = pools[arenaType][rank - 1] || 20;
  const cups = Math.max(1, 12 - rank);
  const mmr = Math.max(1, 15 - rank);

  return { coins, cups, mmr };
}

function getArenaEntryCost(arenaType) {
  return ARENA_ENTRY_COST[arenaType] ?? 20;
}

function isValidArenaType(value) {
  return ARENA_TYPES.includes(value);
}

module.exports = {
  ARENA_TYPES,
  ARENA_ENTRY_COST,
  MAX_ROUNDS,
  MAX_SLOTS,
  applyChoice,
  buildSnapshotFromRun,
  getArenaEntryCost,
  getArenaWindow,
  isValidArenaType,
  rewardForRank,
  startRun
};
