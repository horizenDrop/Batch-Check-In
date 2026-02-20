const playerId = ensurePlayerId();
const CONNECTED_FLAG_KEY = 'batch_checkin_wallet_connected';
const state = {
  address: null,
  profile: null,
  busy: false,
  refreshInFlight: false
};

const el = {
  connectBtn: document.getElementById('connectBtn'),
  stateBox: document.getElementById('stateBox'),
  log: document.getElementById('log')
};

init();

function init() {
  bindEvents();
  autoConnectWallet();
  refreshState();
  setInterval(() => {
    refreshState({ silent: true });
  }, 10_000);
}

function bindEvents() {
  el.connectBtn.addEventListener('click', connectWallet);

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
      ...(state.address ? { 'x-wallet-address': state.address } : {}),
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
    el.connectBtn.textContent = short(address);
    renderState();
    refreshState({ silent: true });
    log(`Wallet connected (${source}): ${short(state.address)}`);
    return address;
  } catch (error) {
    if (allowPrompt) log(`Connect failed: ${error.message}`);
    return null;
  }
}

async function refreshState(options = {}) {
  const { silent = false } = options;
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;

  try {
    const payload = await api('/api/checkin/state');
    state.profile = payload.profile;
    renderState();
  } catch (error) {
    if (!silent) log(`State refresh failed: ${error.message}`);
  } finally {
    state.refreshInFlight = false;
  }
}

async function runBatchCheckin(count) {
  if (state.busy) return;
  state.busy = true;
  setActionButtonsDisabled(true);

  try {
    if (!state.address) {
      await connectWalletInternal({ allowPrompt: true, source: 'action' });
      if (!state.address) throw new Error('Connect wallet first');
    }

    await ensureBaseMainnet();
    const prepared = await api('/api/checkin/prepare', {
      method: 'POST',
      body: JSON.stringify({ count })
    });
    const txRef = await sendCheckinTransaction(prepared.txRequest);
    let txHash = txRef.txHash || null;
    if (txHash) {
      log(`Onchain tx submitted: ${shortHash(txHash)}`);
      await waitForTxReceipt(txHash);
    } else {
      log(`Call submitted: ${shortHash(txRef.callId)}`);
      txHash = await waitForCallTransactionHash(txRef.callId);
      log(`Onchain tx resolved: ${shortHash(txHash)}`);
    }

    log('Transaction confirmed on Base.');

    const executePayload = await api('/api/checkin/onchain-execute', {
      method: 'POST',
      body: JSON.stringify({
        txHash,
        count
      })
    });

    state.profile = executePayload.profile;
    renderState();
    log(`Success: applied ${executePayload.applied} check-ins with onchain tx.`);
  } catch (error) {
    log(`Batch check-in failed: ${error.message}`);
  } finally {
    state.busy = false;
    setActionButtonsDisabled(false);
  }
}

async function ensureBaseMainnet() {
  if (!window.ethereum) throw new Error('Wallet provider not available');
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (String(chainId).toLowerCase() === '0x2105') return;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x2105' }]
    });
  } catch (error) {
    throw new Error(`Switch to Base Mainnet failed: ${error.message}`);
  }
}

async function sendCheckinTransaction(txRequest) {
  if (!window.ethereum) throw new Error('Wallet provider not available');
  if (!txRequest || typeof txRequest !== 'object') throw new Error('Invalid txRequest');
  const txParams = [
    {
      from: state.address,
      to: txRequest.to,
      value: normalizeHexValue(txRequest.value),
      data: txRequest.data
    }
  ];

  try {
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: txParams
    });
    if (!txHash) throw new Error('Transaction hash missing');
    return { txHash };
  } catch (error) {
    try {
      const callId = await window.ethereum.request({
        method: 'wallet_sendCalls',
        params: [
          {
            version: '1.0',
            chainId: '0x2105',
            from: state.address,
            calls: [{
              to: txRequest.to,
              value: normalizeHexValue(txRequest.value),
              data: txRequest.data
            }]
          }
        ]
      });
      if (!callId) throw new Error('wallet_sendCalls did not return id');
      return { callId };
    } catch {
      throw new Error(`Unable to submit onchain tx: ${error.message}`);
    }
  }
}

async function waitForTxReceipt(txHash, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await window.ethereum.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash]
    });
    if (receipt) {
      if (receipt.status === '0x1') return receipt;
      throw new Error('Transaction reverted');
    }
    await sleep(1500);
  }
  throw new Error('Transaction confirmation timeout');
}

async function waitForCallTransactionHash(callId, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await window.ethereum.request({
      method: 'wallet_getCallsStatus',
      params: [callId]
    });

    const receipts = status?.receipts || [];
    const lastReceipt = [...receipts].reverse().find((item) => item?.transactionHash || item?.txHash);
    const txHash = lastReceipt?.transactionHash || lastReceipt?.txHash || null;
    const finalized = status?.status === 'CONFIRMED' || status?.status === 'confirmed';
    if (finalized && txHash) return txHash;

    await sleep(1500);
  }
  throw new Error('Call confirmation timeout');
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
    <div><b>Network:</b> Base Mainnet</div>
    <div><b>Total Check-Ins:</b> ${profile.totalCheckins}</div>
    <div><b>Executed Actions:</b> ${profile.actions}</div>
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
  el.connectBtn.textContent = short(address);
  renderState();
  refreshState({ silent: true });
}

function onDisconnect() {
  state.address = null;
  localStorage.removeItem(CONNECTED_FLAG_KEY);
  el.connectBtn.textContent = 'Connect Wallet';
  renderState();
}

function isBaseAppContext() {
  const ua = String(navigator.userAgent || '').toLowerCase();
  return ua.includes('base') || ua.includes('farcaster');
}

function short(value) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortHash(value) {
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function normalizeHexValue(value) {
  if (!value) return '0x0';
  if (typeof value !== 'string') return '0x0';
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(normalized)) {
    throw new Error('Invalid transaction value from prepare endpoint');
  }
  return normalized;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  el.log.textContent = `${line}\n${el.log.textContent}`.slice(0, 6000);
}
