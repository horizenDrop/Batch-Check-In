const { methodGuard, readBody, json, badRequest, getPlayerId, tooManyRequests } = require('../_lib/http');
const { startRun } = require('../_lib/engine');
const db = require('../_lib/state');
const { getOrCreatePlayer } = require('../_lib/service');
const { checkRateLimit } = require('../_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const playerId = getPlayerId(req, body);
  if (!playerId) return badRequest(res, 'playerId is required');

  const rl = await checkRateLimit({
    key: `run_start:${playerId}`,
    limit: 15,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return tooManyRequests(res, 'Too many run start requests', rl.retryAfterMs);

  const player = await getOrCreatePlayer(playerId);
  player.stats.runsStarted += 1;
  await db.savePlayer(player);

  const run = startRun(playerId);
  await db.saveRun(run);

  json(res, 200, { ok: true, run });
};
