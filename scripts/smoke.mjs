import runStart from '../api/run/start.js';
import runChoice from '../api/run/choice.js';
import runFinish from '../api/run/finish.js';
import builds from '../api/builds.js';
import arenaEnter from '../api/arena/enter.js';
import arenaState from '../api/arena/state.js';
import leaderboard from '../api/leaderboard.js';
import player from '../api/player.js';

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

  const started = await call(runStart, { method: 'POST', body: {}, headers });
  assertOk(started, 'run/start');

  for (let i = 0; i < 10; i += 1) {
    const picked = await call(runChoice, { method: 'POST', body: { choiceIndex: i % 3 }, headers });
    assertOk(picked, 'run/choice');
    if (picked.payload.run.status !== 'active') break;
  }

  const finished = await call(runFinish, { method: 'POST', body: { slotIndex: 0 }, headers });
  assertOk(finished, 'run/finish');
  const buildId = finished.payload.build.buildId;

  const entered = await call(arenaEnter, {
    method: 'POST',
    body: { buildId, arenaType: 'small' },
    headers
  });
  assertOk(entered, 'arena/enter');

  const playerState = await call(player, { headers });
  assertOk(playerState, 'player');

  const buildState = await call(builds, { headers });
  assertOk(buildState, 'builds');

  const arena = await call(arenaState, { headers, query: { type: 'small' } });
  assertOk(arena, 'arena/state');

  const board = await call(leaderboard, { query: { type: 'small' } });
  assertOk(board, 'leaderboard');

  console.log(
    JSON.stringify(
      {
        ok: true,
        playerId: headers['x-player-id'],
        builds: buildState.payload.builds.length,
        arenaEntries: arena.payload.myEntries.length,
        coins: playerState.payload.player.currency_soft
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
