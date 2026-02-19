let createClient = null;
try {
  ({ createClient } = require('redis'));
} catch {
  createClient = null;
}

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

module.exports = {
  getRedisClient
};
