import health from '../api/health.js';
import streakState from '../api/streak/state.js';
import streakPrepare from '../api/streak/prepare.js';

function call(handler, { method = 'GET', body = {}, query = {}, headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method, body, query, headers };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload, headers: this.headers });
      }
    };
    handler(req, res);
  });
}

function assertOk(result, label) {
  if (!result.payload?.ok) {
    throw new Error(`${label} failed: ${result.payload?.error || 'unknown error'}`);
  }
}

async function main() {
  if (!process.env.CHECKIN_CONTRACT_ADDRESS) {
    process.env.CHECKIN_CONTRACT_ADDRESS = '0x000000000000000000000000000000000000dEaD';
  }

  const headers = { 'x-player-id': `smoke_${Date.now()}` };
  const address = '0x1111111111111111111111111111111111111111';

  const healthResult = await call(health);
  assertOk(healthResult, 'health');

  const before = await call(streakState, {
    headers: { ...headers, 'x-wallet-address': address }
  });
  assertOk(before, 'streak/state before');
  if (before.payload.profile.totalCheckins !== 0) {
    throw new Error('initial totalCheckins should be 0');
  }

  const prepared = await call(streakPrepare, {
    method: 'POST',
    headers,
    body: {}
  });
  assertOk(prepared, 'streak/prepare');

  const txRequest = prepared.payload.txRequest || {};
  if (String(txRequest.to || '').toLowerCase() !== process.env.CHECKIN_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error('prepared tx must target configured contract');
  }
  if (!String(txRequest.data || '').startsWith('0x')) {
    throw new Error('prepared tx must include calldata');
  }
  if (String(txRequest.value || '').toLowerCase() !== '0x0') {
    throw new Error('prepared tx value should be 0x0');
  }

  const wrongMethod = await call(streakPrepare, { method: 'GET', headers });
  if (wrongMethod.statusCode !== 405 || wrongMethod.payload?.ok !== false) {
    throw new Error('prepare GET should be rejected with 405');
  }

  const after = await call(streakState, {
    headers: { ...headers, 'x-wallet-address': address }
  });
  assertOk(after, 'streak/state after');
  if (after.payload.profile.totalCheckins !== 0 || after.payload.profile.streak !== 0) {
    throw new Error('state must stay unchanged without onchain execute');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        playerId: headers['x-player-id'],
        app: healthResult.payload.app,
        totalCheckins: after.payload.profile.totalCheckins,
        streak: after.payload.profile.streak,
        contract: txRequest.to
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
