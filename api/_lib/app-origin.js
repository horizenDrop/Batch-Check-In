function normalizeHost(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return null;

  let host = value;
  if (host.includes('://')) {
    try {
      host = new URL(host).host;
    } catch {
      return null;
    }
  }

  host = host.split(',')[0].trim();
  host = host.split('/')[0].trim();
  host = host.replace(/\.+$/, '');
  host = host.split(':')[0].trim();
  return host || null;
}

function getAllowedHosts() {
  const hosts = new Set();

  const appHost = normalizeHost(process.env.APP_URL);
  if (appHost) hosts.add(appHost);

  const envHosts = String(process.env.ALLOWED_APP_HOSTS || '')
    .split(',')
    .map((entry) => normalizeHost(entry))
    .filter(Boolean);
  for (const host of envHosts) hosts.add(host);

  if (process.env.NODE_ENV !== 'production') {
    hosts.add('localhost');
    hosts.add('127.0.0.1');
  }

  return hosts;
}

function getRequestHost(req) {
  const headers = req?.headers || {};
  return normalizeHost(
    headers['x-forwarded-host'] ||
    headers.host ||
    ''
  );
}

function verifyAppOrigin(req) {
  const allowedHosts = getAllowedHosts();
  if (!allowedHosts.size) {
    return {
      ok: true,
      skipped: true,
      requestHost: getRequestHost(req),
      allowedHosts: []
    };
  }

  const requestHost = getRequestHost(req);
  if (!requestHost) {
    if (process.env.NODE_ENV !== 'production') {
      return {
        ok: true,
        skipped: true,
        requestHost: null,
        allowedHosts: [...allowedHosts]
      };
    }

    return {
      ok: false,
      requestHost: null,
      allowedHosts: [...allowedHosts]
    };
  }

  if (allowedHosts.has(requestHost)) {
    return {
      ok: true,
      requestHost,
      allowedHosts: [...allowedHosts]
    };
  }

  return {
    ok: false,
    requestHost,
    allowedHosts: [...allowedHosts]
  };
}

module.exports = {
  verifyAppOrigin
};
