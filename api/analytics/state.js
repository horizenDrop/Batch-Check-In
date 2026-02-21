const { json, methodGuard } = require('../_lib/http');
const analytics = require('../_lib/analytics-store');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'GET')) return;

  try {
    const limitRaw = Number(req.query?.limit || 20);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

    const [summary, recent] = await Promise.all([
      analytics.getSummary(),
      analytics.getRecent(limit)
    ]);

    return json(res, 200, {
      ok: true,
      summary,
      recent
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'analytics.state.unhandled_error',
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      })
    );
    return json(res, 500, { ok: false, error: 'Server error while loading analytics state' });
  }
};
