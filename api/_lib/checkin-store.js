const db = require('./state');
const { DAY_SECONDS } = require('./checkin-contract');

const memory = {
  profiles: new Map(),
  txClaims: new Map(),
  txLocks: new Map()
};

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function profileKey(playerId) {
  return `checkin:profile:${playerId}`;
}

function txClaimKey(txHash) {
  return `checkin:txclaim:${String(txHash).toLowerCase()}`;
}

function txLockKey(txHash) {
  return `checkin:txlock:${String(txHash).toLowerCase()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function unixToIso(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function dayToIso(day) {
  const numeric = Number(day || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return unixToIso(numeric * DAY_SECONDS);
}

function defaultProfile(subjectId) {
  return {
    subjectId,
    streak: 0,
    totalCheckins: 0,
    lastCheckInDay: 0,
    lastCheckInAt: null,
    nextCheckInAt: null,
    canCheckInNow: true,
    lastTxHash: null,
    updatedAt: nowIso()
  };
}

async function getProfile(subjectId) {
  const redis = await db.getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(profileKey(subjectId));
      const parsed = safeJsonParse(raw);
      return parsed || defaultProfile(subjectId);
    } catch {
      // fallback to in-memory profile on Redis read issues
      return memory.profiles.get(subjectId) || defaultProfile(subjectId);
    }
  }

  return memory.profiles.get(subjectId) || defaultProfile(subjectId);
}

async function saveProfile(profile) {
  const subjectId = profile.subjectId || profile.playerId;
  if (!subjectId) throw new Error('Profile subjectId is required');

  const next = { ...profile, subjectId, updatedAt: nowIso() };
  const redis = await db.getRedisClient();
  if (redis) {
    try {
      await redis.set(profileKey(subjectId), JSON.stringify(next));
      return next;
    } catch {
      // continue with memory fallback when Redis is unavailable
    }
  }

  memory.profiles.set(subjectId, next);
  return next;
}

async function applyDailyCheckin(subjectId, eventData) {
  const current = await getProfile(subjectId);
  const next = {
    ...current,
    streak: Number(eventData.streak || 0),
    totalCheckins: Number(eventData.totalCheckins || 0),
    lastCheckInDay: Number(eventData.day || 0),
    lastCheckInAt: dayToIso(eventData.day),
    nextCheckInAt: unixToIso(eventData.nextCheckInAt),
    canCheckInNow: false,
    lastTxHash: eventData.txHash || current.lastTxHash
  };

  return saveProfile(next);
}

async function syncFromOnchain(subjectId, onchainStats) {
  if (!onchainStats) return getProfile(subjectId);

  const current = await getProfile(subjectId);
  const next = {
    ...current,
    streak: Number(onchainStats.streak || 0),
    totalCheckins: Number(onchainStats.totalCheckins || 0),
    lastCheckInDay: Number(onchainStats.lastCheckInDay || 0),
    lastCheckInAt: dayToIso(onchainStats.lastCheckInDay),
    nextCheckInAt: unixToIso(onchainStats.nextCheckInAt),
    canCheckInNow: Boolean(onchainStats.canCheckInNow)
  };

  const unchanged =
    next.streak === current.streak &&
    next.totalCheckins === current.totalCheckins &&
    next.lastCheckInDay === current.lastCheckInDay &&
    next.lastCheckInAt === current.lastCheckInAt &&
    next.nextCheckInAt === current.nextCheckInAt &&
    next.canCheckInNow === current.canCheckInNow;

  if (unchanged) return current;
  return saveProfile(next);
}

async function acquireTxLock(txHash, ttlMs = 60 * 1000) {
  if (!txHash) return false;
  const key = txLockKey(txHash);
  const redis = await db.getRedisClient();

  if (redis) {
    try {
      const result = await redis.set(key, '1', { NX: true, PX: ttlMs });
      return result === 'OK';
    } catch {
      // fallback to in-memory locking
    }
  }

  const now = Date.now();
  const existing = memory.txLocks.get(key);
  if (existing && existing > now) return false;
  memory.txLocks.set(key, now + ttlMs);
  return true;
}

async function releaseTxLock(txHash) {
  if (!txHash) return;
  const key = txLockKey(txHash);
  const redis = await db.getRedisClient();
  if (redis) {
    try {
      await redis.del(key);
      return;
    } catch {
      // continue with memory cleanup
    }
  }
  memory.txLocks.delete(key);
}

async function getTxClaim(txHash) {
  if (!txHash) return null;
  const key = txClaimKey(txHash);
  const redis = await db.getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(key);
      const parsed = safeJsonParse(raw);
      return parsed || null;
    } catch {
      // fallback to memory when Redis read fails
    }
  }
  return memory.txClaims.get(key) || null;
}

async function saveTxClaim(txHash, payload, ttlMs = 365 * 24 * 60 * 60 * 1000) {
  if (!txHash) return;
  const key = txClaimKey(txHash);
  const redis = await db.getRedisClient();
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(payload), { PX: ttlMs });
      return;
    } catch {
      // continue with memory fallback
    }
  }
  memory.txClaims.set(key, payload);
}

module.exports = {
  acquireTxLock,
  applyDailyCheckin,
  getProfile,
  getTxClaim,
  releaseTxLock,
  syncFromOnchain,
  saveTxClaim
};
