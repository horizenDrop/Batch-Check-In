const { badRequest, getPlayerId, json, methodGuard, readBody, tooManyRequests } = require('../_lib/http');
const store = require('../_lib/checkin-store');
const { checkRateLimit } = require('../_lib/rate-limit');
const { createChallengeToken } = require('../_lib/session-token');

const ALLOWED_COUNTS = new Set([1, 10, 100]);

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const playerId = getPlayerId(req, body);
  if (!playerId) return badRequest(res, 'playerId is required');

  const rl = await checkRateLimit({
    scope: 'checkin_request',
    key: playerId,
    limit: 60,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return tooManyRequests(res, 'Too many challenge requests', rl.retryAfterMs);

  const count = Number(body.count);
  if (!ALLOWED_COUNTS.has(count)) return badRequest(res, 'count must be 1, 10, or 100');

  const address = String(body.address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return badRequest(res, 'Valid wallet address is required');

  const challenge = store.createChallenge({ playerId, address, count });
  const challengeToken = createChallengeToken(challenge);

  console.log(
    JSON.stringify({
      event: 'checkin.request.challenge_created',
      playerId,
      wallet: address.toLowerCase(),
      count,
      expiresAt: challenge.expiresAt,
      timestamp: new Date().toISOString()
    })
  );

  json(res, 200, {
    ok: true,
    challenge: {
      challengeToken,
      nonce: challenge.nonce,
      message: challenge.message,
      expiresAt: challenge.expiresAt,
      count
    }
  });
};
