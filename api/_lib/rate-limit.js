const state = require('./state');

const memoryCounters = new Map();
let memoryOps = 0;

function memoryKey(scope, key, bucket) {
  return `${scope}:${key}:${bucket}`;
}

function cleanupMemoryCounters(currentBucket) {
  // Keep current and previous bucket only to avoid unbounded in-memory growth.
  for (const key of memoryCounters.keys()) {
    const lastColon = key.lastIndexOf(':');
    if (lastColon < 0) continue;
    const bucket = Number(key.slice(lastColon + 1));
    if (!Number.isFinite(bucket)) continue;
    if (bucket < currentBucket - 1) {
      memoryCounters.delete(key);
    }
  }
}

async function checkRateLimit({ scope, key, limit, windowMs }) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const redis = await state.getRedisClient();

  if (redis) {
    try {
      const redisKey = `rl:${scope}:${key}:${bucket}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.pexpire(redisKey, windowMs);
      }
      return {
        allowed: count <= limit,
        count,
        remaining: Math.max(0, limit - count),
        retryAfterMs: windowMs
      };
    } catch {
      // fallback to in-memory limiter when Redis operations fail
    }
  }

  const keyMem = memoryKey(scope, key, bucket);
  const current = memoryCounters.get(keyMem) || 0;
  const count = current + 1;
  memoryCounters.set(keyMem, count);
  memoryOps += 1;

  if (memoryOps % 128 === 0) {
    cleanupMemoryCounters(bucket);
  }

  return {
    allowed: count <= limit,
    count,
    remaining: Math.max(0, limit - count),
    retryAfterMs: windowMs
  };
}

module.exports = {
  checkRateLimit
};
