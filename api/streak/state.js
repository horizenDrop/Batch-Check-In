const { badRequest, getPlayerId, json, methodGuard } = require('../_lib/http');
const { getCheckinContractAddress, readOnchainStats } = require('../_lib/checkin-contract');
const { normalizeAddress } = require('../_lib/evm');
const { getBaseProvider } = require('../_lib/base-provider');
const store = require('../_lib/checkin-store');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'GET')) return;

  try {
    const playerId = getPlayerId(req, {});
    if (!playerId) return badRequest(res, 'playerId is required');

    const walletAddress = normalizeAddress(req.query?.address || req.headers['x-wallet-address']);
    const subjectId = walletAddress ? `wallet:${walletAddress}` : playerId;
    let profile = await store.getProfile(subjectId);

    if (walletAddress) {
      const contractAddress = getCheckinContractAddress();
      if (contractAddress) {
        const onchainStats = await readOnchainStats(getBaseProvider(), contractAddress, walletAddress);
        if (onchainStats) {
          profile = await store.syncFromOnchain(subjectId, onchainStats);
        }
      }
    }

    return json(res, 200, { ok: true, profile });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'streak.state.unhandled_error',
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      })
    );
    return json(res, 500, { ok: false, error: 'Server error while loading state' });
  }
};
