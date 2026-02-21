const { badRequest, getPlayerId, json, methodGuard, readBody, tooManyRequests } = require('../_lib/http');
const { checkRateLimit } = require('../_lib/rate-limit');
const analytics = require('../_lib/analytics-store');
const { normalizeAddress } = require('../_lib/evm');

function getRequestId(req) {
  return String(req.headers['x-request-id'] || req.headers['x-vercel-id'] || '').trim() || null;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  try {
    const body = await readBody(req);
    const playerId = getPlayerId(req, body);
    if (!playerId) return badRequest(res, 'playerId is required');

    const rl = await checkRateLimit({
      scope: 'analytics_track',
      key: playerId,
      limit: 240,
      windowMs: 60 * 1000
    });
    if (!rl.allowed) return tooManyRequests(res, 'Too many analytics events', rl.retryAfterMs);

    const eventName = analytics.sanitizeEventName(body.event || body.name);
    if (!eventName) return badRequest(res, 'Valid event is required');

    const tracked = await analytics.trackEvent({
      source: body.source || 'client',
      event: eventName,
      playerId,
      walletAddress: normalizeAddress(body.address || req.headers['x-wallet-address']),
      payload: body.payload || null,
      userAgent: req.headers['user-agent'],
      requestId: getRequestId(req)
    });

    if (!tracked) return badRequest(res, 'Failed to track event');
    return json(res, 200, { ok: true, eventId: tracked.id });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'analytics.track.unhandled_error',
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      })
    );
    return json(res, 500, { ok: false, error: 'Server error during analytics tracking' });
  }
};
