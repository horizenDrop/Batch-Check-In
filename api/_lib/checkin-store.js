const crypto = require('crypto');
const db = require('./state');

const memory = {
  profiles: new Map(),
  idempotency: new Map(),
  txClaims: new Map()
};

function profileKey(playerId) {
  return `checkin:profile:${playerId}`;
}

function idempotencyKey(playerId, requestId) {
  return `checkin:idempotency:${playerId}:${requestId}`;
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

async function getIdempotentResult(playerId, requestId) {
  if (!requestId) return null;
  const redis = await db.getRedisClient();
  if (redis) {
    const raw = await redis.get(idempotencyKey(playerId, requestId));
    return raw ? JSON.parse(raw) : null;
  }

  const item = memory.idempotency.get(idempotencyKey(playerId, requestId)) || null;
  if (!item) return null;
  if (item.expiresAtMs < Date.now()) {
    memory.idempotency.delete(idempotencyKey(playerId, requestId));
    return null;
  }
  return item.payload;
}

async function saveIdempotentResult(playerId, requestId, payload, ttlMs = 15 * 60 * 1000) {
  if (!requestId) return;
  const redis = await db.getRedisClient();
  if (redis) {
    await redis.set(idempotencyKey(playerId, requestId), JSON.stringify(payload), { PX: ttlMs });
    return;
  }

  memory.idempotency.set(idempotencyKey(playerId, requestId), {
    payload,
    expiresAtMs: Date.now() + ttlMs
  });
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

function createChallenge({ playerId, address, count }) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const message = `BatchCheckIn|player:${playerId}|addr:${address}|count:${count}|nonce:${nonce}|exp:${expiresAt}`;

  return {
    nonce,
    playerId,
    address,
    count,
    issuedAt,
    expiresAt,
    message
  };
}

module.exports = {
  applyCheckins,
  createChallenge,
  getIdempotentResult,
  getProfile,
  getTxClaim,
  saveIdempotentResult,
  saveTxClaim
};
