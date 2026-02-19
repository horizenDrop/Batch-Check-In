const { json, getPlayerId, badRequest } = require('./_lib/http');
const db = require('./_lib/state');

module.exports = async function handler(req, res) {
  const playerId = getPlayerId(req, {});
  if (!playerId) return badRequest(res, 'playerId is required');
  const builds = await db.listBuilds(playerId);
  json(res, 200, { ok: true, builds });
};
