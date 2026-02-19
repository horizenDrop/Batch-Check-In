const { methodGuard, readBody, json, badRequest, getPlayerId, tooManyRequests } = require('../_lib/http');
const { applyChoice } = require('../_lib/engine');
const db = require('../_lib/state');
const { checkRateLimit } = require('../_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const playerId = getPlayerId(req, body);
  if (!playerId) return badRequest(res, 'playerId is required');
  const choiceIndex = Number(body.choiceIndex);

  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 2) {
    return badRequest(res, 'choiceIndex must be 0, 1 or 2');
  }

  const rl = await checkRateLimit({
    key: `run_choice:${playerId}`,
    limit: 120,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return tooManyRequests(res, 'Too many run choice requests', rl.retryAfterMs);

  const run = await db.getRun(playerId);
  if (!run) return badRequest(res, 'Active run not found');
  if (run.status !== 'active') return badRequest(res, `Run is not active: ${run.status}`);

  let updated;
  try {
    updated = applyChoice(run, choiceIndex);
  } catch (error) {
    return badRequest(res, error.message);
  }

  await db.saveRun(updated);
  json(res, 200, { ok: true, run: updated });
};
