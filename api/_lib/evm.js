const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const TX_HASH_RE = /^0x[a-f0-9]{64}$/;

function normalizeAddress(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ADDRESS_RE.test(normalized) ? normalized : null;
}

function normalizeTxHash(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return TX_HASH_RE.test(normalized) ? normalized : null;
}

module.exports = {
  normalizeAddress,
  normalizeTxHash
};
