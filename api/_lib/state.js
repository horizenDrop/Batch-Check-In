let createClient = null;
try {
  ({ createClient } = require('redis'));
} catch {
  createClient = null;
}

const memory = {
  players: new Map(),
  runs: new Map(),
  builds: new Map(),
  playerBuildSlots: new Map(),
  arenaEntries: new Map(),
  seasonEntries: new Map(),
  leaderboards: new Map()
};

let redisClientPromise = null;

async function getRedisClient() {
  if (!process.env.REDIS_URL || !createClient) return null;

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const client = createClient({ url: process.env.REDIS_URL });
      client.on('error', () => {});
      await client.connect();
      return client;
    })();
  }

  try {
    return await redisClientPromise;
  } catch {
    return null;
  }
}

function keyPlayer(playerId) {
  return `player:${playerId}`;
}

function keyRun(playerId) {
  return `run:${playerId}`;
}

function keyBuild(buildId) {
  return `build:${buildId}`;
}

function keyBuildSlots(playerId) {
  return `build_slots:${playerId}`;
}

function keyArenaEntry(entryId) {
  return `arena_entry:${entryId}`;
}

function keySeasonEntries(arenaType, seasonId) {
  return `season_entries:${arenaType}:${seasonId}`;
}

function keyLeaderboard(arenaType, seasonId) {
  return `leaderboard:${arenaType}:${seasonId}`;
}

async function getPlayer(playerId) {
  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(keyPlayer(playerId));
    return raw ? JSON.parse(raw) : null;
  }

  return memory.players.get(playerId) || null;
}

async function savePlayer(player) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(keyPlayer(player.playerId), JSON.stringify(player));
    return;
  }

  memory.players.set(player.playerId, player);
}

async function getRun(playerId) {
  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(keyRun(playerId));
    return raw ? JSON.parse(raw) : null;
  }

  return memory.runs.get(playerId) || null;
}

async function saveRun(run) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(keyRun(run.playerId), JSON.stringify(run));
    return;
  }

  memory.runs.set(run.playerId, run);
}

async function clearRun(playerId) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(keyRun(playerId));
    return;
  }

  memory.runs.delete(playerId);
}

async function saveBuild(build) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(keyBuild(build.buildId), JSON.stringify(build));
    const slotsRaw = await redis.get(keyBuildSlots(build.playerId));
    const slots = slotsRaw ? JSON.parse(slotsRaw) : [];
    const filtered = slots.filter((b) => b.slotIndex !== build.slotIndex);
    filtered.push({ buildId: build.buildId, slotIndex: build.slotIndex });
    await redis.set(keyBuildSlots(build.playerId), JSON.stringify(filtered));
    return;
  }

  memory.builds.set(build.buildId, build);
  const slots = memory.playerBuildSlots.get(build.playerId) || [];
  const filtered = slots.filter((b) => b.slotIndex !== build.slotIndex);
  filtered.push({ buildId: build.buildId, slotIndex: build.slotIndex });
  memory.playerBuildSlots.set(build.playerId, filtered);
}

async function getBuild(buildId) {
  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(keyBuild(buildId));
    return raw ? JSON.parse(raw) : null;
  }

  return memory.builds.get(buildId) || null;
}

async function listBuilds(playerId) {
  const redis = await getRedisClient();
  if (redis) {
    const slotsRaw = await redis.get(keyBuildSlots(playerId));
    const slots = slotsRaw ? JSON.parse(slotsRaw) : [];
    const out = [];
    for (const slot of slots) {
      const raw = await redis.get(keyBuild(slot.buildId));
      if (raw) out.push(JSON.parse(raw));
    }
    return out.sort((a, b) => a.slotIndex - b.slotIndex);
  }

  const slots = memory.playerBuildSlots.get(playerId) || [];
  return slots
    .map((slot) => memory.builds.get(slot.buildId))
    .filter(Boolean)
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

async function saveArenaEntry(entry) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(keyArenaEntry(entry.entryId), JSON.stringify(entry));
    const seasonKey = keySeasonEntries(entry.arenaType, entry.seasonId);
    const seasonRaw = await redis.get(seasonKey);
    const season = seasonRaw ? JSON.parse(seasonRaw) : [];
    if (!season.includes(entry.entryId)) season.push(entry.entryId);
    await redis.set(seasonKey, JSON.stringify(season));
    return;
  }

  memory.arenaEntries.set(entry.entryId, entry);
  const seasonKey = keySeasonEntries(entry.arenaType, entry.seasonId);
  const season = memory.seasonEntries.get(seasonKey) || [];
  if (!season.includes(entry.entryId)) season.push(entry.entryId);
  memory.seasonEntries.set(seasonKey, season);
}

async function listSeasonEntries(arenaType, seasonId) {
  const redis = await getRedisClient();
  const seasonKey = keySeasonEntries(arenaType, seasonId);

  if (redis) {
    const raw = await redis.get(seasonKey);
    const ids = raw ? JSON.parse(raw) : [];
    const out = [];
    for (const id of ids) {
      const entryRaw = await redis.get(keyArenaEntry(id));
      if (entryRaw) out.push(JSON.parse(entryRaw));
    }
    return out;
  }

  const ids = memory.seasonEntries.get(seasonKey) || [];
  return ids.map((id) => memory.arenaEntries.get(id)).filter(Boolean);
}

async function saveLeaderboard(arenaType, seasonId, rows) {
  const redis = await getRedisClient();
  const key = keyLeaderboard(arenaType, seasonId);
  if (redis) {
    await redis.set(key, JSON.stringify(rows));
    return;
  }

  memory.leaderboards.set(key, rows);
}

async function getLeaderboard(arenaType, seasonId) {
  const redis = await getRedisClient();
  const key = keyLeaderboard(arenaType, seasonId);

  if (redis) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : [];
  }

  return memory.leaderboards.get(key) || [];
}

module.exports = {
  clearRun,
  getBuild,
  getLeaderboard,
  getPlayer,
  getRedisClient,
  getRun,
  listBuilds,
  listSeasonEntries,
  saveArenaEntry,
  saveBuild,
  saveLeaderboard,
  savePlayer,
  saveRun
};
