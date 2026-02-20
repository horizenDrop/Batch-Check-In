const { badRequest, getPlayerId, json, methodGuard } = require('../_lib/http');
const { ethers } = require('ethers');
const { BASE_CHAIN_ID, getCheckinContractAddress, readOnchainStats } = require('../_lib/checkin-contract');
const store = require('../_lib/checkin-store');

let provider = null;

function getProvider() {
  if (provider) return provider;
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID);
  return provider;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'GET')) return;

  const playerId = getPlayerId(req, {});
  if (!playerId) return badRequest(res, 'playerId is required');

  const walletAddress = String(req.query?.address || req.headers['x-wallet-address'] || '').trim().toLowerCase();
  const subjectId = /^0x[a-f0-9]{40}$/.test(walletAddress) ? `wallet:${walletAddress}` : playerId;
  let profile = await store.getProfile(subjectId);

  if (/^0x[a-f0-9]{40}$/.test(walletAddress)) {
    const contractAddress = getCheckinContractAddress();
    if (contractAddress) {
      const onchainStats = await readOnchainStats(getProvider(), contractAddress, walletAddress);
      if (onchainStats) {
        profile = await store.syncFromOnchain(subjectId, onchainStats);
      }
    }
  }

  json(res, 200, { ok: true, profile });
};
