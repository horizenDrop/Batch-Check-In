const { json, badRequest } = require('./_lib/http');
const { getLeaderboard } = require('./_lib/service');
const { isValidArenaType } = require('./_lib/engine');

module.exports = async function handler(req, res) {
  const arenaType = req.query.type || 'small';
  if (!isValidArenaType(arenaType)) return badRequest(res, 'type must be small|daily|weekly');

  const board = await getLeaderboard(arenaType);
  json(res, 200, { ok: true, arenaType, ...board });
};
