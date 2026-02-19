const { json, getPlayerId, badRequest } = require('./_lib/http');
const db = require('./_lib/state');
const { getOrCreatePlayer } = require('./_lib/service');
const { ARENA_ENTRY_COST } = require('./_lib/engine');

module.exports = async function handler(req, res) {
  const playerId = getPlayerId(req, {});
  if (!playerId) return badRequest(res, 'playerId is required');

  const player = await getOrCreatePlayer(playerId);
  const activeRun = await db.getRun(playerId);

  json(res, 200, {
    ok: true,
    player,
    activeRun,
    arenaEntryCost: ARENA_ENTRY_COST
  });
};
