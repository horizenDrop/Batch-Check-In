const { json, methodGuard } = require('../_lib/http');
const {
  BASE_CHAIN_ID,
  encodeCheckinCalldata,
  getCheckinContractAddress
} = require('../_lib/checkin-contract');
const { verifyAppOrigin } = require('../_lib/app-origin');

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;

  try {
    const origin = verifyAppOrigin(req);
    if (!origin.ok) {
      console.warn(
        JSON.stringify({
          event: 'streak.prepare.forbidden_host',
          requestHost: origin.requestHost,
          originHost: origin.originHost,
          refererHost: origin.refererHost,
          allowedHosts: origin.allowedHosts
        })
      );
      return json(res, 403, {
        ok: false,
        error: 'Forbidden host',
        requestHost: origin.requestHost,
        originHost: origin.originHost,
        refererHost: origin.refererHost,
        allowedHosts: origin.allowedHosts
      });
    }

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
        event: 'streak.prepare.unhandled_error',
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      })
    );
    return json(res, 500, { ok: false, error: 'Server error during prepare' });
  }
};
