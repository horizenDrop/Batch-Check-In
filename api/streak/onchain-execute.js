const { badRequest, getPlayerId, json, methodGuard, readBody, tooManyRequests } = require('../_lib/http');
const { checkRateLimit } = require('../_lib/rate-limit');
const store = require('../_lib/checkin-store');
const { normalizeAddress, normalizeTxHash } = require('../_lib/evm');
const { getBaseProvider } = require('../_lib/base-provider');
const {
  BASE_CHAIN_ID,
  getCheckinContractAddress,
  parseCheckinEventFromReceipt
} = require('../_lib/checkin-contract');

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

  try {
    const body = await readBody(req);
    const playerId = getPlayerId(req, body);
    if (!playerId) return badRequest(res, 'playerId is required');

    const rl = await checkRateLimit({
      scope: 'streak_onchain_execute',
      key: playerId,
      limit: 60,
      windowMs: 60 * 1000
    });
    if (!rl.allowed) return tooManyRequests(res, 'Too many onchain execute requests', rl.retryAfterMs);

    const txHash = normalizeTxHash(body.txHash);
    if (!txHash) return badRequest(res, 'Valid txHash is required');

    const expectedAddressRaw = body.address || req.headers['x-wallet-address'];
    const hasExpectedAddress = String(expectedAddressRaw || '').trim().length > 0;
    const expectedAddress = normalizeAddress(expectedAddressRaw);
    if (hasExpectedAddress && !expectedAddress) return badRequest(res, 'Valid wallet address is required');

    const contractAddress = getCheckinContractAddress();
    if (!contractAddress) {
      return json(res, 500, { ok: false, error: 'CHECKIN_CONTRACT_ADDRESS is not configured' });
    }

    const existingClaim = await store.getTxClaim(txHash);
    if (existingClaim) {
      if (expectedAddress && String(existingClaim.account || '').toLowerCase() !== expectedAddress) {
        return badRequest(res, 'Transaction already claimed by another wallet');
      }
      return json(res, 200, { ok: true, ...existingClaim, idempotent: true });
    }

    const locked = await store.acquireTxLock(txHash);
    if (!locked) {
      const claimed = await store.getTxClaim(txHash);
      if (claimed) return json(res, 200, { ok: true, ...claimed, idempotent: true });
      return badRequest(res, 'Transaction is being processed. Retry in a few seconds.');
    }

    try {
      const existingClaimAfterLock = await store.getTxClaim(txHash);
      if (existingClaimAfterLock) {
        if (expectedAddress && String(existingClaimAfterLock.account || '').toLowerCase() !== expectedAddress) {
          return badRequest(res, 'Transaction already claimed by another wallet');
        }
        return json(res, 200, { ok: true, ...existingClaimAfterLock, idempotent: true });
      }

      const rpc = getBaseProvider();
      const { tx, receipt } = await waitForBaseVisibility(rpc, txHash);
      if (!receipt) return badRequest(res, 'Transaction not visible on Base RPC yet. Retry in a few seconds.');
      if (receipt.status !== 1) return badRequest(res, 'Transaction failed');

      if (tx && Number(tx.chainId || BASE_CHAIN_ID) !== BASE_CHAIN_ID) {
        return badRequest(res, 'Transaction must be on Base Mainnet');
      }

      const eventData = parseCheckinEventFromReceipt(receipt, contractAddress);
      if (!eventData) {
        return badRequest(res, 'CheckedIn event not found in transaction receipt');
      }

      if (expectedAddress && eventData.account !== expectedAddress) {
        return badRequest(res, 'Transaction does not belong to connected wallet');
      }

      const profileId = `wallet:${eventData.account}`;
      const profile = await store.applyDailyCheckin(profileId, {
        streak: eventData.streak,
        totalCheckins: eventData.totalCheckins,
        day: eventData.day,
        nextCheckInAt: eventData.nextCheckInAt,
        txHash
      });

      const responsePayload = {
        applied: 1,
        profile,
        account: eventData.account,
        txHash,
        onchain: {
          streak: eventData.streak,
          totalCheckins: eventData.totalCheckins,
          lastCheckInDay: eventData.day,
          nextCheckInAt: eventData.nextCheckInAt,
          canCheckInNow: false
        },
        tx: {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          feeWei: receipt.fee?.toString?.() || null
        }
      };

      await store.saveTxClaim(txHash, responsePayload);

      console.log(
        JSON.stringify({
          event: 'streak.execute.onchain',
          playerId,
          account: eventData.account,
          txHash,
          streak: eventData.streak,
          totalCheckins: eventData.totalCheckins,
          day: eventData.day,
          nextCheckInAt: eventData.nextCheckInAt,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          contractAddress,
          timestamp: new Date().toISOString()
        })
      );

      return json(res, 200, { ok: true, ...responsePayload });
    } finally {
      try {
        await store.releaseTxLock(txHash);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'streak.txlock.release_failed',
            txHash,
            error: String(error?.message || error)
          })
        );
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'streak.execute.unhandled_error',
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      })
    );
    return json(res, 500, { ok: false, error: 'Server error during onchain execute' });
  }
};
