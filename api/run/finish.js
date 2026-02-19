const { methodGuard, readBody, json, badRequest, getPlayerId, tooManyRequests } = require('../_lib/http');
const { MAX_SLOTS, buildSnapshotFromRun } = require('../_lib/engine');
const db = require('../_lib/state');
const { getOrCreatePlayer } = require('../_lib/service');
const { checkRateLimit } = require('../_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const playerId = getPlayerId(req, body);
  if (!playerId) return badRequest(res, 'playerId is required');
  const slotIndex = Number(body.slotIndex);

  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= MAX_SLOTS) {
    return badRequest(res, `slotIndex must be in range 0..${MAX_SLOTS - 1}`);
  }

  const rl = await checkRateLimit({
    key: `run_finish:${playerId}`,
    limit: 30,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return tooManyRequests(res, 'Too many run finish requests', rl.retryAfterMs);

  const run = await db.getRun(playerId);
  if (!run) return badRequest(res, 'Active run not found');

  const canFinish = run.status === 'ready_to_finish' || run.status === 'failed';
  if (!canFinish) return badRequest(res, 'Run is not ready to finish');

  const build = buildSnapshotFromRun(run, slotIndex);
  await db.saveBuild(build);
  await db.clearRun(playerId);

  const player = await getOrCreatePlayer(playerId);
  player.stats.runsFinished += 1;
  player.currency_soft += 25 + run.round * 3;
  await db.savePlayer(player);

  json(res, 200, {
    ok: true,
    build,
    runResult: {
      status: run.status,
      roundsCompleted: run.round,
      hpLeft: run.hp
    }
  });
};
