const { badRequest, getPlayerId, json, methodGuard, readBody } = require('../_lib/http');
const { tooManyRequests } = require('../_lib/http');
const store = require('../_lib/checkin-store');
const { verifyMessageSignature } = require('../_lib/signature');
const { checkRateLimit } = require('../_lib/rate-limit');
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

  const rl = await checkRateLimit({
    scope: 'checkin_execute',
    key: playerId,
    limit: 120,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return tooManyRequests(res, 'Too many execute requests', rl.retryAfterMs);

  const requestId = String(body.requestId || '').trim();
  if (requestId && !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
    return badRequest(res, 'requestId format is invalid');
  }

  if (requestId) {
    const cached = await store.getIdempotentResult(playerId, requestId);
    if (cached) {
      console.log(
        JSON.stringify({
          event: 'checkin.execute.idempotent_hit',
          playerId,
          requestId,
          timestamp: new Date().toISOString()
        })
      );
      return json(res, 200, { ok: true, ...cached, idempotent: true });
    }
  }

  const sessionToken = String(body.sessionToken || '').trim();
  if (sessionToken) {
    const session = verifySessionToken(sessionToken, playerId);
    if (!session) return badRequest(res, 'Session invalid or expired');

    const count = Number(body.count);
    if (!ALLOWED_COUNTS.has(count)) return badRequest(res, 'count must be 1, 10, or 100');

    const profile = await store.applyCheckins(playerId, count);
    const rotatedSessionToken = createSessionToken({
      playerId,
      address: session.address
    });

    const responsePayload = {
      ok: true,
      applied: count,
      profile,
      sessionToken: rotatedSessionToken
    };
    console.log(
      JSON.stringify({
        event: 'checkin.execute.session',
        playerId,
        count,
        requestId: requestId || null,
        timestamp: new Date().toISOString()
      })
    );
    if (requestId) {
      await store.saveIdempotentResult(playerId, requestId, responsePayload);
    }
    return json(res, 200, responsePayload);
  }

  const challengeToken = String(body.challengeToken || '').trim();
  if (!challengeToken) return badRequest(res, 'challengeToken is required');

  const challengePayload = verifyChallengeToken(challengeToken, playerId);
  if (!challengePayload) return badRequest(res, 'Challenge token invalid or expired');

  const signature = String(body.signature || '').trim();
  if (!signature) return badRequest(res, 'signature is required');

  let verifyResult = { valid: false, method: 'none', walletType: 'unknown', reason: 'unset' };
  try {
    verifyResult = await verifyMessageSignature({
      message: challengePayload.message,
      signature,
      expectedAddress: challengePayload.address
    });
  } catch (error) {
    return badRequest(res, error.message);
  }

  console.log(
    JSON.stringify({
      event: 'checkin.signature.verify',
      playerId,
      wallet: challengePayload.address,
      count: challengePayload.count,
      valid: verifyResult.valid,
      method: verifyResult.method,
      walletType: verifyResult.walletType,
      reason: verifyResult.reason || null,
      timestamp: new Date().toISOString()
    })
  );

  if (!verifyResult.valid) return badRequest(res, 'Invalid signature');

  const profile = await store.applyCheckins(playerId, challengePayload.count);
  const nextSessionToken = createSessionToken({
    playerId,
    address: challengePayload.address
  });

  const responsePayload = {
    ok: true,
    applied: challengePayload.count,
    profile,
    sessionToken: nextSessionToken
  };
  if (requestId) {
    await store.saveIdempotentResult(playerId, requestId, responsePayload);
  }

  json(res, 200, responsePayload);
};
