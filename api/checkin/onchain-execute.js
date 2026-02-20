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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBaseVisibility(rpc, txHash, timeoutMs = 45_000) {
  const started = Date.now();
  let lastTx = null;
  let lastReceipt = null;

  while (Date.now() - started < timeoutMs) {
    const [tx, receipt] = await Promise.all([
      rpc.getTransaction(txHash).catch(() => null),
      rpc.getTransactionReceipt(txHash).catch(() => null)
    ]);

    if (tx) lastTx = tx;
    if (receipt) lastReceipt = receipt;

    if (lastReceipt && Number(lastReceipt.status) === 1) {
      return { tx: lastTx, receipt: lastReceipt };
    }
    if (lastReceipt && Number(lastReceipt.status) === 0) {
      return { tx: lastTx, receipt: lastReceipt };
    }

    await sleep(1800);
  }

  return { tx: lastTx, receipt: lastReceipt };
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
  const { tx, receipt } = await waitForBaseVisibility(rpc, txHash);
  if (!receipt) return badRequest(res, 'Transaction not visible on Base RPC yet. Retry in a few seconds.');
  if (receipt.status !== 1) return badRequest(res, 'Transaction failed');

  if (tx) {
    const txChain = Number(tx.chainId || 0);
    if (txChain !== BASE_CHAIN_ID) return badRequest(res, 'Transaction must be on Base Mainnet');
  }

  const txFrom = String(tx?.from || '').toLowerCase();
  const txTo = String(tx?.to || '').toLowerCase();
  const rcFrom = String(receipt?.from || '').toLowerCase();
  const rcTo = String(receipt?.to || '').toLowerCase();
  const boundToAddress = [txFrom, txTo, rcFrom, rcTo].includes(address);
  const bindingMode = boundToAddress ? 'bound' : 'unbound_smart_wallet_or_bundler';

  const profileId = `wallet:${address}`;
  const profile = await store.applyCheckins(profileId, count);

  const responsePayload = {
    applied: count,
    profile,
    txHash,
    tx: {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      feeWei: receipt.fee?.toString?.() || null,
      bindingMode
    },
    boundToAddress
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
      boundToAddress,
      bindingMode,
      timestamp: new Date().toISOString()
    })
  );

  return json(res, 200, { ok: true, ...responsePayload });
};
