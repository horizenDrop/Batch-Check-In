const db = require('./state');

const localBuckets = new Map();

function localKey(key, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs);
  return `${key}:${bucket}`;
}

async function checkRateLimit({ key, limit, windowMs }) {
  const redis = await db.getRedisClient();
  if (redis) {
    const bucket = Math.floor(Date.now() / windowMs);
    const redisKey = `ratelimit:${key}:${bucket}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, windowMs);
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterMs: windowMs
    };
  }

  const k = localKey(key, windowMs);
  const current = localBuckets.get(k) || 0;
  const next = current + 1;
  localBuckets.set(k, next);

  return {
    allowed: next <= limit,
    remaining: Math.max(0, limit - next),
    retryAfterMs: windowMs
  };
}

module.exports = {
  checkRateLimit
};
