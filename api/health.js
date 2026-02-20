const db = require('./_lib/state');

module.exports = async function handler(req, res) {
  let redis = 'not_configured';
  const hasRedisUrl = Boolean(String(process.env.REDIS_URL || '').trim());

  if (hasRedisUrl) {
    const client = await db.getRedisClient();
    if (client) {
      try {
        await client.ping();
        redis = 'connected';
      } catch {
        redis = 'error';
      }
    } else {
      redis = 'unavailable';
    }
  }

  res.status(200).json({
    ok: true,
    app: 'daily-streak-lite',
    redis,
    contractConfigured: Boolean(String(process.env.CHECKIN_CONTRACT_ADDRESS || '').trim())
  });
};
