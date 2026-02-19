const { badRequest, getPlayerId, json, methodGuard, readBody } = require('../_lib/http');
const store = require('../_lib/checkin-store');
const { verifyMessageSignature } = require('../_lib/signature');
const { createSessionToken, verifySessionToken } = require('../_lib/session-token');

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

  const nonce = String(body.nonce || '').trim();
  const signature = String(body.signature || '').trim();
  if (!nonce) return badRequest(res, 'nonce is required');
  if (!signature) return badRequest(res, 'signature is required');

  const challenge = await store.getChallenge(nonce);
  if (!challenge) return badRequest(res, 'Challenge not found or expired');
  if (challenge.playerId !== playerId) return badRequest(res, 'Challenge owner mismatch');
  if (!ALLOWED_COUNTS.has(challenge.count)) return badRequest(res, 'Invalid challenge count');

  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    await store.consumeChallenge(challenge.nonce);
    return badRequest(res, 'Challenge expired');
  }

  let valid = false;
  try {
    valid = await verifyMessageSignature({
      message: challenge.message,
      signature,
      expectedAddress: challenge.address
    });
  } catch (error) {
    return badRequest(res, error.message);
  }

  if (!valid) return badRequest(res, 'Invalid signature');

  await store.consumeChallenge(challenge.nonce);
  const profile = await store.applyCheckins(playerId, challenge.count);
  const nextSessionToken = createSessionToken({
    playerId,
    address: challenge.address
  });

  json(res, 200, {
    ok: true,
    applied: challenge.count,
    profile,
    sessionToken: nextSessionToken
  });
};
