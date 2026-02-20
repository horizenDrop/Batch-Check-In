import health from '../api/health.js';
import checkinState from '../api/checkin/state.js';
import checkinPrepare from '../api/checkin/prepare.js';

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

  const before = await call(checkinState, {
    headers: { ...headers, 'x-wallet-address': address }
  });
  assertOk(before, 'checkin/state before');
  if (before.payload.profile.totalCheckins !== 0) {
    throw new Error('initial totalCheckins should be 0');
  }

  const prepared = await call(checkinPrepare, {
    method: 'POST',
    headers,
    body: {
      count: 10
    }
  });
  assertOk(prepared, 'checkin/prepare');
  if (prepared.payload.txRequest?.to?.toLowerCase() !== process.env.CHECKIN_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error('prepared tx must target configured contract');
  }
  if (!String(prepared.payload.txRequest?.data || '').startsWith('0x')) {
    throw new Error('prepared tx must include calldata');
  }

  const invalidPrepare = await call(checkinPrepare, {
    method: 'POST',
    headers,
    body: {
      count: 2
    }
  });
  if (invalidPrepare.payload?.ok !== false || invalidPrepare.statusCode !== 400) {
    throw new Error('invalid count should return 400');
  }

  const after = await call(checkinState, {
    headers: { ...headers, 'x-wallet-address': address }
  });
  assertOk(after, 'checkin/state after');
  if (after.payload.profile.totalCheckins !== 0) {
    throw new Error('state must not change without onchain execute');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        playerId: headers['x-player-id'],
        totalCheckins: after.payload.profile.totalCheckins,
        actions: after.payload.profile.actions,
        contract: prepared.payload.txRequest?.to
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
