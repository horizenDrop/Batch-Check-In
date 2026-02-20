let createClient = null;
try {
  ({ createClient } = require('redis'));
} catch {
  createClient = null;
}

let redisClientPromise = null;

function normalizeRedisUrl(rawValue) {
  if (!rawValue) return '';
  const input = String(rawValue).trim();
  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    return input.slice(1, -1).trim();
  }
  return input;
}

function buildRedisUrlCandidates(rawValue) {
  const normalized = normalizeRedisUrl(rawValue);
  if (!normalized) return [];

  const candidates = [normalized];
  if (normalized.startsWith('redis://')) {
    candidates.push(`rediss://${normalized.slice('redis://'.length)}`);
  }

  return [...new Set(candidates)];
}

async function connectRedis(candidates) {
  let lastError = null;

  for (const url of candidates) {
    const client = createClient({ url });
    client.on('error', () => {});
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      try {
        await client.disconnect();
      } catch {
        // best effort cleanup
      }
    }
  }

  if (lastError) throw lastError;
  return null;
}

async function getRedisClient() {
  if (!createClient) return null;
  const candidates = buildRedisUrlCandidates(process.env.REDIS_URL);
  if (!candidates.length) return null;

  if (!redisClientPromise) {
    redisClientPromise = connectRedis(candidates);
  }

  try {
    return await redisClientPromise;
  } catch {
    redisClientPromise = null;
    return null;
  }
}

module.exports = {
  getRedisClient
};
