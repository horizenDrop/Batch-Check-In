const { ethers } = require('ethers');
const { badRequest, getPlayerId, json, methodGuard, readBody, tooManyRequests } = require('../_lib/http');
const { checkRateLimit } = require('../_lib/rate-limit');
const store = require('../_lib/checkin-store');

const ALLOWED_COUNTS = new Set([1, 10, 100]);
const BASE_CHAIN_ID = 8453;

let provider = null;

function getProvider() {
  if (provider) return provider;
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID);
  return provider;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const playerId = getPlayerId(req, body);
  if (!playerId) return badRequest(res, 'playerId is required');

  const rl = await checkRateLimit({
    scope: 'checkin_onchain_execute',
    key: playerId,
    limit: 60,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return tooManyRequests(res, 'Too many onchain execute requests', rl.retryAfterMs);

  const count = Number(body.count);
  if (!ALLOWED_COUNTS.has(count)) return badRequest(res, 'count must be 1, 10, or 100');

  const txHash = String(body.txHash || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) return badRequest(res, 'Valid txHash is required');

  const address = String(body.address || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return badRequest(res, 'Valid wallet address is required');

  const existingClaim = await store.getTxClaim(txHash);
  if (existingClaim) {
    return json(res, 200, { ok: true, ...existingClaim, idempotent: true });
  }

  const rpc = getProvider();
  const [tx, receipt] = await Promise.all([rpc.getTransaction(txHash), rpc.getTransactionReceipt(txHash)]);
  if (!tx || !receipt) return badRequest(res, 'Transaction not found yet. Wait for confirmation.');
  if (receipt.status !== 1) return badRequest(res, 'Transaction failed');

  const txChain = Number(tx.chainId || 0);
  if (txChain !== BASE_CHAIN_ID) return badRequest(res, 'Transaction must be on Base Mainnet');

  const txFrom = String(tx.from || '').toLowerCase();
  if (txFrom !== address) return badRequest(res, 'Transaction sender mismatch');

  const txTo = String(tx.to || '').toLowerCase();
  if (txTo !== address) return badRequest(res, 'Use self-transfer transaction for check-in');

  const profileId = `wallet:${address}`;
  const profile = await store.applyCheckins(profileId, count);

  const responsePayload = {
    applied: count,
    profile,
    txHash,
    tx: {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      feeWei: receipt.fee?.toString?.() || null
    }
  };

  await store.saveTxClaim(txHash, responsePayload);

  console.log(
    JSON.stringify({
      event: 'checkin.execute.onchain',
      playerId,
      address,
      txHash,
      count,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      timestamp: new Date().toISOString()
    })
  );

  return json(res, 200, { ok: true, ...responsePayload });
};
