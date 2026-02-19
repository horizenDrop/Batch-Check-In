const crypto = require('crypto');
const db = require('./state');

const memory = {
  profiles: new Map(),
  challenges: new Map()
};

function profileKey(playerId) {
  return `checkin:profile:${playerId}`;
}

function challengeKey(nonce) {
  return `checkin:challenge:${nonce}`;
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

async function saveChallenge(challenge) {
  const redis = await db.getRedisClient();
  if (redis) {
    const ttlMs = Math.max(1, new Date(challenge.expiresAt).getTime() - Date.now());
    await redis.set(challengeKey(challenge.nonce), JSON.stringify(challenge), { PX: ttlMs });
    return;
  }

  memory.challenges.set(challenge.nonce, challenge);
}

async function getChallenge(nonce) {
  const redis = await db.getRedisClient();
  if (redis) {
    const raw = await redis.get(challengeKey(nonce));
    return raw ? JSON.parse(raw) : null;
  }

  const challenge = memory.challenges.get(nonce) || null;
  if (!challenge) return null;
  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    memory.challenges.delete(nonce);
    return null;
  }
  return challenge;
}

async function consumeChallenge(nonce) {
  const redis = await db.getRedisClient();
  if (redis) {
    await redis.del(challengeKey(nonce));
    return;
  }

  memory.challenges.delete(nonce);
}

function createChallenge({ playerId, address, count }) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const message = [
    'Build & Arena Check-In Authorization',
    `playerId:${playerId}`,
    `address:${address}`,
    `count:${count}`,
    `nonce:${nonce}`,
    `issuedAt:${issuedAt}`,
    `expiresAt:${expiresAt}`
  ].join('\n');

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
  consumeChallenge,
  createChallenge,
  getChallenge,
  getProfile,
  saveChallenge
};
