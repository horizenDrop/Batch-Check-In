const { badRequest, getPlayerId, json } = require('../_lib/http');
const store = require('../_lib/checkin-store');

module.exports = async function handler(req, res) {
  const playerId = getPlayerId(req, {});
  if (!playerId) return badRequest(res, 'playerId is required');

  const walletAddress = String(req.query?.address || req.headers['x-wallet-address'] || '').trim().toLowerCase();
  const subjectId = /^0x[a-f0-9]{40}$/.test(walletAddress) ? `wallet:${walletAddress}` : playerId;
  const profile = await store.getProfile(subjectId);
  json(res, 200, { ok: true, profile });
};
