const db = require('./_lib/state');
const { json, methodGuard } = require('./_lib/http');
const { getCheckinContractAddress } = require('./_lib/checkin-contract');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'GET')) return;

  try {
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

    return json(res, 200, {
      ok: true,
      app: 'daily-streak-lite',
      redis,
      contractConfigured: Boolean(getCheckinContractAddress())
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'health.unhandled_error',
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      })
    );
    return json(res, 500, { ok: false, error: 'Server error while checking health' });
  }
};
