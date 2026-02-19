import checkinState from '../api/checkin/state.js';
import checkinRequest from '../api/checkin/request.js';
import checkinExecute from '../api/checkin/execute.js';
import { unsafeDevSignature } from '../api/_lib/signature.js';

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
  const headers = { 'x-player-id': `smoke_${Date.now()}` };
  const address = '0x1111111111111111111111111111111111111111';

  const before = await call(checkinState, { headers });
  assertOk(before, 'checkin/state before');
  if (before.payload.profile.totalCheckins !== 0) {
    throw new Error('initial totalCheckins should be 0');
  }

  const requested = await call(checkinRequest, {
    method: 'POST',
    headers,
    body: {
      address,
      count: 10
    }
  });
  assertOk(requested, 'checkin/request');

  const { message, nonce } = requested.payload.challenge;
  const signature = unsafeDevSignature(message, address);

  const executed = await call(checkinExecute, {
    method: 'POST',
    headers,
    body: {
      nonce,
      signature
    }
  });
  assertOk(executed, 'checkin/execute');
  if (executed.payload.applied !== 10) {
    throw new Error('applied checkins should be 10');
  }

  const after = await call(checkinState, { headers });
  assertOk(after, 'checkin/state after');

  console.log(
    JSON.stringify(
      {
        ok: true,
        playerId: headers['x-player-id'],
        totalCheckins: after.payload.profile.totalCheckins,
        actions: after.payload.profile.actions
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
