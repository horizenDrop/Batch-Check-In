const { methodGuard, readBody, json, badRequest, getPlayerId, tooManyRequests } = require('../_lib/http');
const db = require('../_lib/state');
const { enterArena } = require('../_lib/service');
const { checkRateLimit } = require('../_lib/rate-limit');
const { isValidArenaType } = require('../_lib/engine');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const playerId = getPlayerId(req, body);
  if (!playerId) return badRequest(res, 'playerId is required');
  const { buildId, arenaType } = body;

  if (!buildId) return badRequest(res, 'buildId is required');
  if (!isValidArenaType(arenaType)) return badRequest(res, 'arenaType must be small|daily|weekly');

  const rl = await checkRateLimit({
    key: `arena_enter:${playerId}`,
    limit: 30,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return tooManyRequests(res, 'Too many arena enter requests', rl.retryAfterMs);

  const build = await db.getBuild(buildId);
  if (!build) return badRequest(res, 'Build not found');
  if (build.playerId !== playerId) return badRequest(res, 'Build does not belong to player');
  if (build.locked) return badRequest(res, 'Build is already locked in arena');

  let entry;
  try {
    entry = await enterArena({ arenaType, build, playerId });
  } catch (error) {
    return badRequest(res, error.message);
  }
  json(res, 200, { ok: true, entry });
};
