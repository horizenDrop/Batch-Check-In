const { ethers } = require('ethers');
const { BASE_CHAIN_ID } = require('./checkin-contract');

let provider = null;

function getBaseProvider() {
  if (provider) return provider;

  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID);
  return provider;
}

module.exports = {
  getBaseProvider
};
