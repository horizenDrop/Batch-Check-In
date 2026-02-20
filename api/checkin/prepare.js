const { badRequest, json, methodGuard, readBody } = require('../_lib/http');
const {
  ALLOWED_COUNTS,
  BASE_CHAIN_ID,
  encodeCheckinCalldata,
  getCheckinContractAddress
} = require('../_lib/checkin-contract');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = await readBody(req);
  const count = Number(body.count);
  if (!ALLOWED_COUNTS.has(count)) {
    return badRequest(res, 'count must be 1, 10, or 100');
  }

  const contractAddress = getCheckinContractAddress();
  if (!contractAddress) {
    return json(res, 500, { ok: false, error: 'CHECKIN_CONTRACT_ADDRESS is not configured' });
  }

  const data = encodeCheckinCalldata(count);
  return json(res, 200, {
    ok: true,
    txRequest: {
      chainId: BASE_CHAIN_ID,
      to: contractAddress,
      value: '0x0',
      data
    }
  });
};
