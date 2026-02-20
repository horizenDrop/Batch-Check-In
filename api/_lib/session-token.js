const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function parseBase64urlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function sessionSecret() {
  return process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-in-prod';
}

function signPayload(payload) {
  return crypto
    .createHmac('sha256', sessionSecret())
    .update(payload)
    .digest('base64url');
}

function createSessionToken({ playerId, address, profileId, ttlSeconds = 30 * 60 }) {
  const payload = {
    playerId,
    address: String(address).toLowerCase(),
    profileId: profileId || `wallet:${String(address).toLowerCase()}`,
    sid: crypto.randomUUID().replaceAll('-', ''),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token, expectedPlayerId) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSig = signPayload(encodedPayload);
  if (signature !== expectedSig) return null;

  let payload;
  try {
    payload = parseBase64urlJson(encodedPayload);
  } catch {
    return null;
  }

  if (!payload || payload.playerId !== expectedPlayerId) return null;
  if (!payload.sid || typeof payload.sid !== 'string') return null;
  if (!payload.profileId || typeof payload.profileId !== 'string') return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

function createChallengeToken(challenge) {
  const payload = {
    playerId: challenge.playerId,
    address: String(challenge.address).toLowerCase(),
    count: challenge.count,
    nonce: challenge.nonce,
    exp: Math.floor(new Date(challenge.expiresAt).getTime() / 1000),
    message: challenge.message
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyChallengeToken(token, expectedPlayerId) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSig = signPayload(encodedPayload);
  if (signature !== expectedSig) return null;

  let payload;
  try {
    payload = parseBase64urlJson(encodedPayload);
  } catch {
    return null;
  }

  if (!payload || payload.playerId !== expectedPlayerId) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (![1, 10, 100].includes(Number(payload.count))) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(payload.address))) return null;
  if (typeof payload.message !== 'string' || !payload.message.length) return null;

  return payload;
}

module.exports = {
  createSessionToken,
  createChallengeToken,
  verifyChallengeToken,
  verifySessionToken
};
