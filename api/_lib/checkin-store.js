const db = require('./state');

const memory = {
  profiles: new Map(),
  txClaims: new Map()
};

function profileKey(playerId) {
  return `checkin:profile:${playerId}`;
}

function txClaimKey(txHash) {
  return `checkin:txclaim:${String(txHash).toLowerCase()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultProfile(subjectId) {
  return {
    subjectId,
    totalCheckins: 0,
    actions: 0,
    updatedAt: nowIso()
  };
}

async function getProfile(subjectId) {
  const redis = await db.getRedisClient();
  if (redis) {
    const raw = await redis.get(profileKey(subjectId));
    return raw ? JSON.parse(raw) : defaultProfile(subjectId);
  }

  return memory.profiles.get(subjectId) || defaultProfile(subjectId);
}

async function saveProfile(profile) {
  const subjectId = profile.subjectId || profile.playerId;
  if (!subjectId) throw new Error('Profile subjectId is required');

  const next = { ...profile, subjectId, updatedAt: nowIso() };
  const redis = await db.getRedisClient();
  if (redis) {
    await redis.set(profileKey(subjectId), JSON.stringify(next));
    return next;
  }

  memory.profiles.set(subjectId, next);
  return next;
}

async function applyCheckins(subjectId, count) {
  const current = await getProfile(subjectId);
  current.totalCheckins += count;
  current.actions += 1;
  return saveProfile(current);
}

async function getTxClaim(txHash) {
  if (!txHash) return null;
  const key = txClaimKey(txHash);
  const redis = await db.getRedisClient();
  if (redis) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return memory.txClaims.get(key) || null;
}

async function saveTxClaim(txHash, payload, ttlMs = 365 * 24 * 60 * 60 * 1000) {
  if (!txHash) return;
  const key = txClaimKey(txHash);
  const redis = await db.getRedisClient();
  if (redis) {
    await redis.set(key, JSON.stringify(payload), { PX: ttlMs });
    return;
  }
  memory.txClaims.set(key, payload);
}

module.exports = {
  applyCheckins,
  getProfile,
  getTxClaim,
  saveTxClaim
};
