const { ethers } = require('ethers');

const BASE_CHAIN_ID = 8453;
const ALLOWED_COUNTS = new Set([1, 10, 100]);
const CHECKIN_ABI = [
  'function checkIn(uint256 count)',
  'event CheckedIn(address indexed account, uint256 count)'
];

const checkinInterface = new ethers.Interface(CHECKIN_ABI);

function getCheckinContractAddress() {
  const value = String(process.env.CHECKIN_CONTRACT_ADDRESS || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(value)) return null;
  return value;
}

function encodeCheckinCalldata(count) {
  const numeric = Number(count);
  if (!ALLOWED_COUNTS.has(numeric)) {
    throw new Error('count must be 1, 10, or 100');
  }

  return checkinInterface.encodeFunctionData('checkIn', [numeric]);
}

function parseCheckinEventFromReceipt(receipt, contractAddress) {
  const target = String(contractAddress || '').toLowerCase();
  for (const log of receipt?.logs || []) {
    if (String(log.address || '').toLowerCase() !== target) continue;

    let parsed = null;
    try {
      parsed = checkinInterface.parseLog(log);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.name !== 'CheckedIn') continue;

    const account = String(parsed.args.account || '').toLowerCase();
    const count = Number(parsed.args.count);
    if (!/^0x[a-f0-9]{40}$/.test(account)) continue;
    if (!ALLOWED_COUNTS.has(count)) continue;

    return {
      account,
      count
    };
  }

  return null;
}

module.exports = {
  ALLOWED_COUNTS,
  BASE_CHAIN_ID,
  encodeCheckinCalldata,
  getCheckinContractAddress,
  parseCheckinEventFromReceipt
};
