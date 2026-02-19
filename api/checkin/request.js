const { badRequest, getPlayerId, json, methodGuard, readBody } = require('../_lib/http');
const store = require('../_lib/checkin-store');
const { createChallengeToken } = require('../_lib/session-token');

const ALLOWED_COUNTS = new Set([1, 10, 100]);

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const playerId = getPlayerId(req, body);
  if (!playerId) return badRequest(res, 'playerId is required');

  const count = Number(body.count);
  if (!ALLOWED_COUNTS.has(count)) return badRequest(res, 'count must be 1, 10, or 100');

  const address = String(body.address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return badRequest(res, 'Valid wallet address is required');

  const challenge = store.createChallenge({ playerId, address, count });
  const challengeToken = createChallengeToken(challenge);

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
