const crypto = require('crypto');
const db = require('./state');
const { getArenaEntryCost, getArenaWindow, rewardForRank } = require('./engine');

function defaultPlayer(playerId) {
  return {
    playerId,
    nickname: `Player-${playerId.slice(0, 6)}`,
    wallet: null,
    currency_soft: 0,
    currency_hard: 0,
    cups: 0,
    leaderboard_points: 0,
    mmr_small: 1000,
    mmr_daily: 1000,
    mmr_weekly: 1000,
    stats: {
      runsStarted: 0,
      runsFinished: 0,
      arenaEntries: 0,
      wins: 0
    }
  };
}

async function getOrCreatePlayer(playerId) {
  const existing = await db.getPlayer(playerId);
  if (existing) return existing;

  const created = defaultPlayer(playerId);
  await db.savePlayer(created);
  return created;
}

async function resolveArenaIfNeeded(arenaType, seasonId) {
  const entries = await db.listSeasonEntries(arenaType, seasonId);
  if (!entries.length) {
    return { resolved: false, entries: [] };
  }

  const resultAt = new Date(entries[0].resultAt).getTime();
  if (Date.now() < resultAt) {
    return { resolved: false, entries };
  }

  const allResolved = entries.every((e) => e.status === 'resolved');
  if (allResolved) {
    return { resolved: true, entries };
  }

  const sorted = [...entries].sort((a, b) => {
    if (b.powerScore !== a.powerScore) return b.powerScore - a.powerScore;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const leaderboard = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const rank = i + 1;
    const entry = sorted[i];
    const reward = rewardForRank(arenaType, rank);

    const updated = {
      ...entry,
      rank,
      reward,
      status: 'resolved',
      resolvedAt: new Date().toISOString()
    };
    await db.saveArenaEntry(updated);

    const player = await getOrCreatePlayer(entry.playerId);
    player.currency_soft += reward.coins;
    player.cups += reward.cups;
    player.leaderboard_points += reward.cups;
    player[`mmr_${arenaType}`] += reward.mmr;
    player.stats.wins += rank === 1 ? 1 : 0;
    await db.savePlayer(player);

    const build = await db.getBuild(entry.buildId);
    if (build) {
      build.locked = false;
      build.lockedByArenaEntryId = null;
      await db.saveBuild(build);
    }

    leaderboard.push({
      rank,
      score: entry.powerScore,
      playerId: entry.playerId,
      nickname: player.nickname
    });
  }

  await db.saveLeaderboard(arenaType, seasonId, leaderboard);
  return { resolved: true, entries: sorted };
}

async function enterArena({ arenaType, build, playerId }) {
  const window = getArenaWindow(arenaType, new Date());

  await resolveArenaIfNeeded(arenaType, window.seasonId);
  const seasonEntries = await db.listSeasonEntries(arenaType, window.seasonId);
  const alreadyEntered = seasonEntries.some((entry) => entry.playerId === playerId && entry.status !== 'cancelled');
  if (alreadyEntered) {
    throw new Error('Player already entered this arena season');
  }

  const player = await getOrCreatePlayer(playerId);
  const entryCost = getArenaEntryCost(arenaType);
  if (player.currency_soft < entryCost) {
    throw new Error(`Not enough coins for ${arenaType} arena. Required: ${entryCost}`);
  }

  const entry = {
    entryId: crypto.randomUUID(),
    arenaType,
    seasonId: window.seasonId,
    playerId,
    buildId: build.buildId,
    powerScore: build.powerScore,
    lockAt: window.lockAt,
    resultAt: window.resultAt,
    status: 'pending',
    rank: null,
    reward: null,
    createdAt: new Date().toISOString(),
    entryCost
  };

  build.locked = true;
  build.lockedByArenaEntryId = entry.entryId;

  await db.saveBuild(build);
  await db.saveArenaEntry(entry);

  player.currency_soft -= entryCost;
  player.stats.arenaEntries += 1;
  await db.savePlayer(player);

  return entry;
}

async function getArenaState(arenaType, playerId) {
  const window = getArenaWindow(arenaType, new Date());
  await resolveArenaIfNeeded(arenaType, window.seasonId);

  const entries = await db.listSeasonEntries(arenaType, window.seasonId);
  const mine = entries.filter((e) => e.playerId === playerId);
  const now = Date.now();
  const resultAtMs = new Date(window.resultAt).getTime();

  return {
    window,
    totalEntries: entries.length,
    myEntries: mine,
    entryCost: getArenaEntryCost(arenaType),
    secondsUntilResolve: Math.max(0, Math.floor((resultAtMs - now) / 1000))
  };
}

async function getLeaderboard(arenaType) {
  const window = getArenaWindow(arenaType, new Date());
  await resolveArenaIfNeeded(arenaType, window.seasonId);

  const rows = await db.getLeaderboard(arenaType, window.seasonId);
  return {
    seasonId: window.seasonId,
    rows
  };
}

module.exports = {
  enterArena,
  getArenaState,
  getLeaderboard,
  getOrCreatePlayer,
  resolveArenaIfNeeded
};
