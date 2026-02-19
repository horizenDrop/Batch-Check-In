const state = require('./state');

const memoryCounters = new Map();

function memoryKey(scope, key, bucket) {
  return `${scope}:${key}:${bucket}`;
}

async function checkRateLimit({ scope, key, limit, windowMs }) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const redis = await state.getRedisClient();

  if (redis) {
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
  }

  const keyMem = memoryKey(scope, key, bucket);
  const current = memoryCounters.get(keyMem) || 0;
  const count = current + 1;
  memoryCounters.set(keyMem, count);

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
