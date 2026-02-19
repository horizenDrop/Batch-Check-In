function json(res, code, payload) {
  res.status(code).json(payload);
}

function badRequest(res, message) {
  json(res, 400, { ok: false, error: message });
}

function tooManyRequests(res, message, retryAfterMs) {
  if (retryAfterMs) {
    const retrySeconds = Math.ceil(retryAfterMs / 1000);
    res.setHeader('Retry-After', String(retrySeconds));
  }
  json(res, 429, { ok: false, error: message });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }

  return {};
}

function methodGuard(req, res, expected) {
  if (req.method !== expected) {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return false;
  }

  return true;
}

function getPlayerId(req, body) {
  const raw = (
    req.headers['x-player-id'] ||
    body.playerId ||
    req.query?.playerId ||
    'demo-player'
  );

  const value = String(raw).trim();
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(value)) return null;
  return value;
}

module.exports = {
  badRequest,
  getPlayerId,
  json,
  methodGuard,
  readBody,
  tooManyRequests
};
