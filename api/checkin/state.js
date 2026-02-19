const { badRequest, getPlayerId, json } = require('../_lib/http');
const store = require('../_lib/checkin-store');

module.exports = async function handler(req, res) {
  const playerId = getPlayerId(req, {});
  if (!playerId) return badRequest(res, 'playerId is required');

  const profile = await store.getProfile(playerId);
  json(res, 200, { ok: true, profile });
};
