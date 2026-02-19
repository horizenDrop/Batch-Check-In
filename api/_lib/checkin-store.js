const crypto = require('crypto');
const db = require('./state');

const memory = {
  profiles: new Map(),
  idempotency: new Map()
};

function profileKey(playerId) {
  return `checkin:profile:${playerId}`;
}

function idempotencyKey(playerId, requestId) {
  return `checkin:idempotency:${playerId}:${requestId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultProfile(playerId) {
  return {
    playerId,
    totalCheckins: 0,
    actions: 0,
    updatedAt: nowIso()
  };
}

async function getProfile(playerId) {
  const redis = await db.getRedisClient();
  if (redis) {
    const raw = await redis.get(profileKey(playerId));
    return raw ? JSON.parse(raw) : defaultProfile(playerId);
  }

  return memory.profiles.get(playerId) || defaultProfile(playerId);
}

async function saveProfile(profile) {
  const next = { ...profile, updatedAt: nowIso() };
  const redis = await db.getRedisClient();
  if (redis) {
    await redis.set(profileKey(profile.playerId), JSON.stringify(next));
    return next;
  }

  memory.profiles.set(profile.playerId, next);
  return next;
}

async function applyCheckins(playerId, count) {
  const current = await getProfile(playerId);
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
  saveIdempotentResult
};
