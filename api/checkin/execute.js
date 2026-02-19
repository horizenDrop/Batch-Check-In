const { badRequest, getPlayerId, json, methodGuard, readBody } = require('../_lib/http');
const store = require('../_lib/checkin-store');
const { verifyMessageSignature } = require('../_lib/signature');
const {
  createSessionToken,
  verifyChallengeToken,
  verifySessionToken
} = require('../_lib/session-token');

const ALLOWED_COUNTS = new Set([1, 10, 100]);

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const playerId = getPlayerId(req, body);
  if (!playerId) return badRequest(res, 'playerId is required');

  const sessionToken = String(body.sessionToken || '').trim();
  if (sessionToken) {
    const session = verifySessionToken(sessionToken, playerId);
    if (!session) return badRequest(res, 'Session invalid or expired');

    const count = Number(body.count);
    if (!ALLOWED_COUNTS.has(count)) return badRequest(res, 'count must be 1, 10, or 100');

    const profile = await store.applyCheckins(playerId, count);
    return json(res, 200, {
      ok: true,
      applied: count,
      profile,
      sessionToken
    });
  }

  const challengeToken = String(body.challengeToken || '').trim();
  if (!challengeToken) return badRequest(res, 'challengeToken is required');

  const challengePayload = verifyChallengeToken(challengeToken, playerId);
  if (!challengePayload) return badRequest(res, 'Challenge token invalid or expired');

  const signature = String(body.signature || '').trim();
  if (!signature) return badRequest(res, 'signature is required');

  let valid = false;
  try {
    valid = await verifyMessageSignature({
      message: challengePayload.message,
      signature,
      expectedAddress: challengePayload.address
    });
  } catch (error) {
    return badRequest(res, error.message);
  }

  if (!valid) return badRequest(res, 'Invalid signature');

  const profile = await store.applyCheckins(playerId, challengePayload.count);
  const nextSessionToken = createSessionToken({
    playerId,
    address: challengePayload.address
  });

  json(res, 200, {
    ok: true,
    applied: challengePayload.count,
    profile,
    sessionToken: nextSessionToken
  });
};
