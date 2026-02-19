const crypto = require('crypto');

function unsafeDevSignature(message, expectedAddress) {
  const digest = crypto
    .createHash('sha256')
    .update(`${message}:${String(expectedAddress).toLowerCase()}`)
    .digest('hex');
  return `unsafe:${digest}`;
}

let cachedProvider = null;

async function getBaseProvider(ethers) {
  if (cachedProvider) return cachedProvider;
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  cachedProvider = new ethers.JsonRpcProvider(rpcUrl, 8453);
  return cachedProvider;
}

async function verifyErc1271(ethers, expectedAddress, message, signature) {
  const provider = await getBaseProvider(ethers);
  const code = await provider.getCode(expectedAddress);
  if (!code || code === '0x') return false;

  const contract = new ethers.Contract(
    expectedAddress,
    [
      'function isValidSignature(bytes32 _hash, bytes _signature) view returns (bytes4)',
      'function isValidSignature(bytes _data, bytes _signature) view returns (bytes4)'
    ],
    provider
  );

  const MAGIC_VALUE = '0x1626ba7e';
  const hash = ethers.hashMessage(message);

  try {
    const resultHash = await contract['isValidSignature(bytes32,bytes)'](hash, signature);
    if (String(resultHash).toLowerCase() === MAGIC_VALUE) return true;
  } catch {}

  try {
    const bytesData = ethers.toUtf8Bytes(message);
    const resultBytes = await contract['isValidSignature(bytes,bytes)'](bytesData, signature);
    if (String(resultBytes).toLowerCase() === MAGIC_VALUE) return true;
  } catch {}

  return false;
}

async function verifyMessageSignature({ message, signature, expectedAddress }) {
  let ethers;
  try {
    ethers = require('ethers');
  } catch {
    return {
      valid: signature === unsafeDevSignature(message, expectedAddress),
      method: 'unsafe_dev_signature',
      walletType: 'unknown',
      reason: 'ethers_not_installed'
    };
  }

  const expected = String(expectedAddress).toLowerCase();

  try {
    const recoveredText = ethers.verifyMessage(message, signature);
    if (recoveredText.toLowerCase() === expected) {
      return { valid: true, method: 'eoa_text', walletType: 'eoa' };
    }
  } catch {}

  try {
    const messageHex = ethers.hexlify(ethers.toUtf8Bytes(message));
    const recoveredBytes = ethers.verifyMessage(ethers.getBytes(messageHex), signature);
    if (recoveredBytes.toLowerCase() === expected) {
      return { valid: true, method: 'eoa_hex_bytes', walletType: 'eoa' };
    }
  } catch {}

  // Some providers sign the literal hex string as plain text.
  try {
    const messageHexLiteral = ethers.hexlify(ethers.toUtf8Bytes(message));
    const recoveredHexLiteral = ethers.verifyMessage(messageHexLiteral, signature);
    if (recoveredHexLiteral.toLowerCase() === expected) {
      return { valid: true, method: 'eoa_hex_literal', walletType: 'eoa' };
    }
  } catch {}

  try {
    const is1271Valid = await verifyErc1271(ethers, expectedAddress, message, signature);
    if (is1271Valid) {
      return { valid: true, method: 'erc1271', walletType: 'contract' };
    }
  } catch {}

  return { valid: false, method: 'none', walletType: 'unknown', reason: 'no_verification_path_matched' };
}

module.exports = {
  unsafeDevSignature,
  verifyMessageSignature
};
