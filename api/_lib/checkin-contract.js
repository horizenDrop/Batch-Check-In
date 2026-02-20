const { ethers } = require('ethers');

const BASE_CHAIN_ID = 8453;
const DAY_SECONDS = 24 * 60 * 60;
const CHECKIN_ABI = [
  'function checkIn()',
  'function getStats(address account) view returns (uint32 streak, uint64 totalCheckIns, uint64 lastCheckInDay, bool canCheckInNow, uint64 nextCheckInAt)',
  'event CheckedIn(address indexed account, uint32 streak, uint64 totalCheckIns, uint64 day, uint64 nextCheckInAt)'
];

const checkinInterface = new ethers.Interface(CHECKIN_ABI);

function getCheckinContractAddress() {
  const value = String(process.env.CHECKIN_CONTRACT_ADDRESS || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(value)) return null;
  return value;
}

function encodeCheckinCalldata() {
  return checkinInterface.encodeFunctionData('checkIn', []);
}

function toNumber(value, fallback = 0) {
  try {
    if (value === null || value === undefined) return fallback;
    return Number(value);
  } catch {
    return fallback;
  }
}

function normalizeStats(stats) {
  if (!stats) return null;

  return {
    streak: toNumber(stats.streak, 0),
    totalCheckins: toNumber(stats.totalCheckIns, 0),
    lastCheckInDay: toNumber(stats.lastCheckInDay, 0),
    canCheckInNow: Boolean(stats.canCheckInNow),
    nextCheckInAt: toNumber(stats.nextCheckInAt, 0)
  };
}

async function readOnchainStats(provider, contractAddress, account) {
  if (!provider || !contractAddress || !account) return null;
  if (!/^0x[a-f0-9]{40}$/.test(String(account).toLowerCase())) return null;

  const contract = new ethers.Contract(contractAddress, CHECKIN_ABI, provider);
  let raw = null;
  try {
    raw = await contract.getStats(account);
  } catch {
    return null;
  }

  return normalizeStats(raw);
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
    if (!/^0x[a-f0-9]{40}$/.test(account)) continue;

    const streak = toNumber(parsed.args.streak, 0);
    const totalCheckins = toNumber(parsed.args.totalCheckIns, 0);
    const day = toNumber(parsed.args.day, 0);
    const nextCheckInAt = toNumber(parsed.args.nextCheckInAt, 0);

    return {
      account,
      streak,
      totalCheckins,
      day,
      nextCheckInAt,
      canCheckInNow: false
    };
  }

  return null;
}

module.exports = {
  BASE_CHAIN_ID,
  CHECKIN_ABI,
  DAY_SECONDS,
  encodeCheckinCalldata,
  getCheckinContractAddress,
  normalizeStats,
  parseCheckinEventFromReceipt,
  readOnchainStats
};
