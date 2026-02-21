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

function hostFromUrlLike(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    return normalizeHost(new URL(raw).host);
  } catch {
    return null;
  }
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

function getOriginHost(req) {
  const headers = req?.headers || {};
  return hostFromUrlLike(headers.origin);
}

function getRefererHost(req) {
  const headers = req?.headers || {};
  return hostFromUrlLike(headers.referer || headers.referrer);
}

function verifyAppOrigin(req) {
  const allowedHosts = getAllowedHosts();
  const requestHost = getRequestHost(req);
  const originHost = getOriginHost(req);
  const refererHost = getRefererHost(req);

  if (!allowedHosts.size) {
    return {
      ok: true,
      skipped: true,
      requestHost,
      originHost,
      refererHost,
      allowedHosts: []
    };
  }
  if (!requestHost) {
    if (process.env.NODE_ENV !== 'production') {
      return {
        ok: true,
        skipped: true,
        requestHost: null,
        originHost,
        refererHost,
        allowedHosts: [...allowedHosts]
      };
    }

    return {
      ok: false,
      requestHost: null,
      originHost,
      refererHost,
      allowedHosts: [...allowedHosts]
    };
  }

  const allowRequestHost = allowedHosts.has(requestHost);
  const allowOriginHost = !originHost || allowedHosts.has(originHost);
  const allowRefererHost = !refererHost || allowedHosts.has(refererHost);

  if (allowRequestHost && allowOriginHost && allowRefererHost) {
    return { ok: true, requestHost, originHost, refererHost, allowedHosts: [...allowedHosts] };
  }

  return {
    ok: false,
    requestHost,
    originHost,
    refererHost,
    allowedHosts: [...allowedHosts]
  };
}

module.exports = {
  verifyAppOrigin
};
