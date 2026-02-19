const playerId = ensurePlayerId();
const CONNECTED_FLAG_KEY = 'batch_checkin_wallet_connected';
const LAST_ADDRESS_KEY = 'batch_checkin_last_address';
const SESSION_TOKEN_KEY = 'batch_checkin_session_token';
const state = {
  address: null,
  profile: null,
  busy: false,
  sessionToken: localStorage.getItem(SESSION_TOKEN_KEY) || null
};

const el = {
  connectBtn: document.getElementById('connectBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  stateBox: document.getElementById('stateBox'),
  log: document.getElementById('log')
};

init();

function init() {
  bindEvents();
  autoConnectWallet();
  refreshState();
}

function bindEvents() {
  el.connectBtn.addEventListener('click', connectWallet);
  el.refreshBtn.addEventListener('click', refreshState);

  for (const button of document.querySelectorAll('button[data-count]')) {
    button.addEventListener('click', () => runBatchCheckin(Number(button.dataset.count)));
  }

  if (window.ethereum && typeof window.ethereum.on === 'function') {
    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('disconnect', onDisconnect);
  }
}

function ensurePlayerId() {
  const key = 'batch_checkin_player_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `p_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-player-id': playerId,
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function connectWallet() {
  return connectWalletInternal({ allowPrompt: true, source: 'manual' });
}

async function autoConnectWallet() {
  try {
    await connectWalletInternal({ allowPrompt: false, source: 'auto' });
    if (state.address) return;

    const connectedBefore = localStorage.getItem(CONNECTED_FLAG_KEY) === '1';
    if (connectedBefore || isBaseAppContext()) {
      await connectWalletInternal({ allowPrompt: true, source: 'auto-restore' });
    }
  } catch {
    // Silent by design for auto-connect attempts.
  }
}

async function connectWalletInternal({ allowPrompt, source }) {
  try {
    if (!window.ethereum) {
      throw new Error('No EVM wallet found in webview/browser');
    }

    let accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if ((!accounts || !accounts.length) && allowPrompt) {
      accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    }

    const address = (accounts && accounts[0]) || null;
    if (!address) {
      if (allowPrompt) throw new Error('Wallet account not available');
      return null;
    }

    state.address = address;
    localStorage.setItem(CONNECTED_FLAG_KEY, '1');
    localStorage.setItem(LAST_ADDRESS_KEY, address);
    el.connectBtn.textContent = short(address);
    renderState();
    log(`Wallet connected (${source}): ${short(state.address)}`);
    return address;
  } catch (error) {
    if (allowPrompt) log(`Connect failed: ${error.message}`);
    return null;
  }
}

async function refreshState() {
  try {
    const payload = await api('/api/checkin/state');
    state.profile = payload.profile;
    renderState();
  } catch (error) {
    log(`State refresh failed: ${error.message}`);
  }
}

async function runBatchCheckin(count) {
  if (state.busy) return;
  state.busy = true;
  setActionButtonsDisabled(true);

  try {
    if (state.sessionToken) {
      const fast = await api('/api/checkin/execute', {
        method: 'POST',
        body: JSON.stringify({
          sessionToken: state.sessionToken,
          count
        })
      });
      state.profile = fast.profile;
      renderState();
      log(`Applied ${fast.applied} check-ins via session (no new signature).`);
      return;
    }

    if (!state.address) {
      await connectWalletInternal({ allowPrompt: true, source: 'action' });
      if (!state.address) throw new Error('Connect wallet first');
    }

    const requestPayload = await api('/api/checkin/request', {
      method: 'POST',
      body: JSON.stringify({ count, address: state.address })
    });

    const message = requestPayload.challenge.message;
    const challengeToken = requestPayload.challenge.challengeToken;
    log(`Challenge prepared for ${count} check-ins`);

    const signature = await signMessageWithFallback(message, state.address);

    const executePayload = await api('/api/checkin/execute', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, signature })
    });

    state.profile = executePayload.profile;
    if (executePayload.sessionToken) {
      state.sessionToken = executePayload.sessionToken;
      localStorage.setItem(SESSION_TOKEN_KEY, executePayload.sessionToken);
    }
    renderState();
    log(`Success: applied ${executePayload.applied} check-ins. Session enabled for next actions.`);
  } catch (error) {
    if (String(error.message).toLowerCase().includes('session invalid')) {
      clearSessionToken();
      log('Session expired. Please sign once again.');
    }
    log(`Batch check-in failed: ${error.message}`);
  } finally {
    state.busy = false;
    setActionButtonsDisabled(false);
  }
}

async function signMessageWithFallback(message, address) {
  const messageHex = utf8ToHex(message);
  const attempts = [
    [message, address],
    [messageHex, address],
    [address, message],
    [address, messageHex]
  ];

  let lastError = null;
  for (const params of attempts) {
    try {
      return await window.ethereum.request({
        method: 'personal_sign',
        params
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'Unable to sign message');
}

function setActionButtonsDisabled(disabled) {
  for (const button of document.querySelectorAll('button[data-count]')) {
    button.disabled = disabled;
  }
}

function renderState() {
  const profile = state.profile || { totalCheckins: 0, actions: 0, updatedAt: '-' };
  el.connectBtn.textContent = state.address ? short(state.address) : 'Connect Wallet';
  el.stateBox.innerHTML = `
    <div><b>Wallet:</b> ${state.address ? short(state.address) : 'not connected'}</div>
    <div><b>Session:</b> ${state.sessionToken ? 'active' : 'signature required'}</div>
    <div><b>Total Check-Ins:</b> ${profile.totalCheckins}</div>
    <div><b>Signed Actions:</b> ${profile.actions}</div>
  `;
}

function onAccountsChanged(accounts) {
  const address = (accounts && accounts[0]) || null;
  if (!address) {
    onDisconnect();
    return;
  }
  state.address = address;
  localStorage.setItem(CONNECTED_FLAG_KEY, '1');
  localStorage.setItem(LAST_ADDRESS_KEY, address);
  el.connectBtn.textContent = short(address);
  renderState();
}

function onDisconnect() {
  state.address = null;
  localStorage.removeItem(CONNECTED_FLAG_KEY);
  localStorage.removeItem(LAST_ADDRESS_KEY);
  clearSessionToken();
  el.connectBtn.textContent = 'Connect Wallet';
  renderState();
}

function isBaseAppContext() {
  const ua = String(navigator.userAgent || '').toLowerCase();
  return ua.includes('base') || ua.includes('farcaster');
}

function clearSessionToken() {
  state.sessionToken = null;
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

function short(value) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function utf8ToHex(value) {
  const bytes = new TextEncoder().encode(value);
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  el.log.textContent = `${line}\n${el.log.textContent}`.slice(0, 6000);
}
