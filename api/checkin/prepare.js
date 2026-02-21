const { json, methodGuard } = require('../_lib/http');
const {
  BASE_CHAIN_ID,
  encodeCheckinCalldata,
  getCheckinContractAddress
} = require('../_lib/checkin-contract');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  try {
    const contractAddress = getCheckinContractAddress();
    if (!contractAddress) {
      return json(res, 500, { ok: false, error: 'CHECKIN_CONTRACT_ADDRESS is not configured' });
    }

    const data = encodeCheckinCalldata();
    return json(res, 200, {
      ok: true,
      txRequest: {
        chainId: BASE_CHAIN_ID,
        to: contractAddress,
        value: '0x0',
        data
      }
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'checkin.prepare.unhandled_error',
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      })
    );
    return json(res, 500, { ok: false, error: 'Server error during prepare' });
  }
};
