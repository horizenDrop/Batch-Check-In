const { json, methodGuard } = require('../_lib/http');
const analytics = require('../_lib/analytics-store');
const { verifyAppOrigin } = require('../_lib/app-origin');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'GET')) return;

  try {
    const origin = verifyAppOrigin(req);
    if (!origin.ok) {
      console.warn(
        JSON.stringify({
          event: 'analytics.state.forbidden_host',
          requestHost: origin.requestHost,
          allowedHosts: origin.allowedHosts
        })
      );
      return json(res, 403, {
        ok: false,
        error: 'Forbidden host',
        requestHost: origin.requestHost,
        allowedHosts: origin.allowedHosts
      });
    }

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
