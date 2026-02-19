const { json, getPlayerId, badRequest } = require('../_lib/http');
const { getArenaState } = require('../_lib/service');
const { isValidArenaType } = require('../_lib/engine');

module.exports = async function handler(req, res) {
  const arenaType = req.query.type || 'small';
  if (!isValidArenaType(arenaType)) return badRequest(res, 'type must be small|daily|weekly');

  const playerId = getPlayerId(req, {});
  if (!playerId) return badRequest(res, 'playerId is required');
  const state = await getArenaState(arenaType, playerId);
  json(res, 200, { ok: true, arenaType, ...state });
};
