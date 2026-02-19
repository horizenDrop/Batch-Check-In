const playerId = ensurePlayerId();
const state = {
  address: null,
  profile: null,
  busy: false
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
  refreshState();
}

function bindEvents() {
  el.connectBtn.addEventListener('click', connectWallet);
  el.refreshBtn.addEventListener('click', refreshState);

  for (const button of document.querySelectorAll('button[data-count]')) {
    button.addEventListener('click', () => runBatchCheckin(Number(button.dataset.count)));
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
  try {
    if (!window.ethereum) {
      throw new Error('No EVM wallet found in webview/browser');
    }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = (accounts && accounts[0]) || null;
    if (!address) throw new Error('Wallet account not available');
    state.address = address;
    renderState();
    log(`Wallet connected: ${short(state.address)}`);
  } catch (error) {
    log(`Connect failed: ${error.message}`);
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
    if (!state.address) {
      await connectWallet();
      if (!state.address) throw new Error('Connect wallet first');
    }

    const requestPayload = await api('/api/checkin/request', {
      method: 'POST',
      body: JSON.stringify({ count, address: state.address })
    });

    const message = requestPayload.challenge.message;
    const nonce = requestPayload.challenge.nonce;
    log(`Challenge prepared for ${count} check-ins`);

    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, state.address]
    });

    const executePayload = await api('/api/checkin/execute', {
      method: 'POST',
      body: JSON.stringify({ nonce, signature })
    });

    state.profile = executePayload.profile;
    renderState();
    log(`Success: applied ${executePayload.applied} check-ins with one signature`);
  } catch (error) {
    log(`Batch check-in failed: ${error.message}`);
  } finally {
    state.busy = false;
    setActionButtonsDisabled(false);
  }
}

function setActionButtonsDisabled(disabled) {
  for (const button of document.querySelectorAll('button[data-count]')) {
    button.disabled = disabled;
  }
}

function renderState() {
  const profile = state.profile || { totalCheckins: 0, actions: 0, updatedAt: '-' };
  el.stateBox.innerHTML = `
    <div><b>Player ID:</b> ${playerId}</div>
    <div><b>Wallet:</b> ${state.address ? short(state.address) : 'not connected'}</div>
    <div><b>Total Check-Ins:</b> ${profile.totalCheckins}</div>
    <div><b>Signed Actions:</b> ${profile.actions}</div>
    <div><b>Updated:</b> ${profile.updatedAt || '-'}</div>
  `;
}

function short(value) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  el.log.textContent = `${line}\n${el.log.textContent}`.slice(0, 6000);
}
