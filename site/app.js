const playerId = ensurePlayerId();
const CONNECTED_FLAG_KEY = 'daily_streak_wallet_connected';
const LAST_ADDRESS_KEY = 'daily_streak_last_address';
const ANALYTICS_ENDPOINT = '/api/analytics/track';
let miniAppSdkModulePromise = null;
const state = {
  address: null,
  lastKnownAddress: getLastKnownAddress(),
  profile: null,
  busy: false,
  refreshInFlight: false,
  refreshQueued: false,
  profileHydrated: false
};

const el = {
  connectBtn: document.getElementById('connectBtn'),
  checkinBtn: document.getElementById('checkinBtn'),
  walletBadge: document.getElementById('walletBadge'),
  networkBadge: document.getElementById('networkBadge'),
  statusBadge: document.getElementById('statusBadge'),
  statsGrid: document.getElementById('statsGrid'),
  cooldownHint: document.getElementById('cooldownHint')
};

init();

function init() {
  bindEvents();
  trackEvent('session_start', {
    baseAppContext: isBaseAppContext()
  });
  notifyMiniAppReady();
  autoConnectWallet();
  renderState();
  refreshState();
  setInterval(() => refreshState({ silent: true }), 10_000);
  setInterval(() => updateTimingUI(), 1_000);
}

function bindEvents() {
  el.connectBtn.addEventListener('click', connectWallet);
  el.checkinBtn.addEventListener('click', runDailyCheckin);

  if (window.ethereum && typeof window.ethereum.on === 'function') {
    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('disconnect', onDisconnect);
  }
}

function ensurePlayerId() {
  const key = 'daily_streak_player_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `p_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
}

function defaultProfile() {
  return {
    streak: 0,
    totalCheckins: 0,
    lastCheckInAt: null,
    nextCheckInAt: null,
    canCheckInNow: true
  };
}

async function api(path, options = {}) {
  const walletHeaderAddress = state.address || state.lastKnownAddress || null;
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-player-id': playerId,
      ...(walletHeaderAddress ? { 'x-wallet-address': walletHeaderAddress } : {}),
      ...(options.headers || {})
    }
  });

  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = null;
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error(`Invalid JSON (HTTP ${response.status})`);
  }
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
    // silent auto-connect
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

    state.address = String(address).toLowerCase();
    state.lastKnownAddress = state.address;
    localStorage.setItem(CONNECTED_FLAG_KEY, '1');
    localStorage.setItem(LAST_ADDRESS_KEY, state.address);
    renderState();
    refreshState({ silent: true });
    trackEvent('wallet_connected', { source });
    log(`Wallet connected (${source}): ${short(state.address)}`);
    return state.address;
  } catch (error) {
    if (allowPrompt) {
      trackEvent('wallet_connect_failed', {
        source,
        reason: safeErrorMessage(error)
      });
      log(`Connect failed: ${error.message}`);
    }
    return null;
  }
}

async function refreshState(options = {}) {
  const { silent = false } = options;
  if (state.refreshInFlight) {
    state.refreshQueued = true;
    return null;
  }
  state.refreshInFlight = true;
  try {
    const payload = await api('/api/streak/state');
    state.profile = payload.profile || defaultProfile();
    state.profileHydrated = true;
    renderState();
    return payload;
  } catch (error) {
    if (!silent) log(`State refresh failed: ${error.message}`);
    return null;
  } finally {
    state.refreshInFlight = false;
    if (state.refreshQueued) {
      state.refreshQueued = false;
      setTimeout(() => {
        refreshState({ silent: true });
      }, 0);
    }
  }
}

async function runDailyCheckin() {
  if (state.busy) return;
  trackEvent('checkin_attempt', { phase: 'start' });
  await refreshState({ silent: true });
  if (!isReadyNow()) {
    trackEvent('checkin_blocked', { reason: 'cooldown_before_prepare' });
    log('Daily check-in is still on cooldown.');
    return;
  }

  state.busy = true;
  updateTimingUI();

  try {
    if (!state.address) {
      await connectWalletInternal({ allowPrompt: true, source: 'action' });
      if (!state.address) throw new Error('Connect wallet first');
    }

    await ensureBaseMainnet();
    await refreshState({ silent: true });
    if (!isReadyNow()) {
      trackEvent('checkin_blocked', { reason: 'cooldown_after_refresh' });
      log('Daily check-in is on cooldown after state refresh.');
      return;
    }
    const prepared = await api('/api/streak/prepare', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const txRef = await sendCheckinTransaction(prepared.txRequest);
    let txHash = txRef.txHash || null;
    if (txHash) {
      trackEvent('checkin_tx_submitted', { mode: 'eth_sendTransaction', txHash: shortHash(txHash) });
      log(`Onchain tx submitted: ${shortHash(txHash)}`);
      await waitForTxReceipt(txHash);
    } else {
      trackEvent('checkin_tx_submitted', { mode: 'wallet_sendCalls', callId: shortHash(txRef.callId) });
      log(`Call submitted: ${shortHash(txRef.callId)}`);
      txHash = await waitForCallTransactionHash(txRef.callId);
      trackEvent('checkin_tx_resolved', { txHash: shortHash(txHash) });
      log(`Onchain tx resolved: ${shortHash(txHash)}`);
    }

    trackEvent('checkin_tx_confirmed', { txHash: shortHash(txHash) });
    log('Transaction confirmed on Base.');

    const executePayload = await api('/api/streak/onchain-execute', {
      method: 'POST',
      body: JSON.stringify({
        txHash,
        address: state.address
      })
    });

    state.profile = executePayload.profile || state.profile;
    renderState();
    trackEvent('checkin_success', {
      streak: state.profile?.streak || 0,
      totalCheckins: state.profile?.totalCheckins || 0
    });
    log(`Success: streak ${state.profile?.streak || 0}, total ${state.profile?.totalCheckins || 0}.`);
  } catch (error) {
    trackEvent('checkin_failed', { reason: safeErrorMessage(error) });
    log(`Daily check-in failed: ${error.message}`);
  } finally {
    state.busy = false;
    updateTimingUI();
    refreshState({ silent: true });
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
    if (isUserRejectedError(error)) {
      throw new Error('User rejected transaction');
    }
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
    } catch (fallbackError) {
      if (isUserRejectedError(fallbackError)) {
        throw new Error('User rejected transaction');
      }
      throw new Error(`Unable to submit onchain tx: ${fallbackError?.message || error.message}`);
    }
  }
}

async function waitForTxReceipt(txHash, timeoutMs = 120_000) {
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
    await sleep(1_500);
  }
  throw new Error('Transaction confirmation timeout');
}

async function waitForCallTransactionHash(callId, timeoutMs = 120_000) {
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

    await sleep(1_500);
  }
  throw new Error('Call confirmation timeout');
}

function renderState() {
  const profile = { ...defaultProfile(), ...(state.profile || {}) };
  el.connectBtn.textContent = state.address ? short(state.address) : 'Connect Wallet';
  el.walletBadge.textContent = state.address
    ? short(state.address)
    : (state.lastKnownAddress ? `Last ${short(state.lastKnownAddress)}` : 'Not Connected');
  el.networkBadge.textContent = 'Base Mainnet';

  el.statsGrid.innerHTML = `
    <article class="stat-box">
      <div class="stat-label">Current Streak</div>
      <div class="stat-value orange">${profile.streak}</div>
    </article>
    <article class="stat-box">
      <div class="stat-label">Total Check-Ins</div>
      <div class="stat-value">${profile.totalCheckins}</div>
    </article>
    <article class="stat-box">
      <div class="stat-label">Next Check-In</div>
      <div id="nextCheckinValue" class="stat-value small cyan">${formatNextCheckInText(profile)}</div>
    </article>
  `;

  updateTimingUI();
}

function updateTimingUI() {
  const ready = isReadyNow();
  const profile = { ...defaultProfile(), ...(state.profile || {}) };
  const connected = Boolean(state.address);
  const hasProfile = state.profileHydrated;

  el.statusBadge.textContent = ready ? 'Ready' : 'Cooldown';
  el.statusBadge.style.borderColor = ready ? 'rgba(34,217,137,0.45)' : 'rgba(255,151,86,0.45)';
  el.statusBadge.style.color = ready ? '#bff9dd' : '#ffd1ad';

  const nextValueEl = document.getElementById('nextCheckinValue');
  if (nextValueEl) nextValueEl.textContent = formatNextCheckInText(profile);

  if (!connected) {
    el.checkinBtn.disabled = state.busy;
    el.checkinBtn.textContent = state.busy ? 'Processing...' : 'Connect Wallet To Check-In';
    if (state.lastKnownAddress && hasProfile) {
      el.cooldownHint.textContent = `Last known wallet ${short(state.lastKnownAddress)} loaded. Connect to send tx.`;
    } else {
      el.cooldownHint.textContent = 'Connect wallet to start your daily streak.';
    }
    return;
  }

  el.checkinBtn.disabled = state.busy || !ready;
  el.checkinBtn.textContent = state.busy ? 'Processing...' : (ready ? 'Run Daily Check-In' : 'Cooldown Active');
  el.cooldownHint.textContent = ready
    ? 'Ready now. Submit one low-cost check-in transaction.'
    : 'Cooldown active. Time is shown in Next Check-In above.';
}

function isReadyNow() {
  const profile = { ...defaultProfile(), ...(state.profile || {}) };
  if (profile.canCheckInNow) return true;
  if (!profile.nextCheckInAt) return true;
  const nextMs = Date.parse(profile.nextCheckInAt);
  if (!Number.isFinite(nextMs)) return true;
  return Date.now() >= nextMs;
}

function formatNextCheckInText(profile) {
  if (isReadyNow()) return 'Ready now';
  return formatRemaining(profile.nextCheckInAt);
}

function formatRemaining(nextCheckInAt) {
  const nextMs = Date.parse(String(nextCheckInAt || ''));
  if (!Number.isFinite(nextMs)) return 'Ready now';
  const diff = nextMs - Date.now();
  if (diff <= 0) return 'Ready now';

  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function onAccountsChanged(accounts) {
  const address = (accounts && accounts[0]) || null;
  if (!address) {
    onDisconnect();
    return;
  }

  state.address = String(address).toLowerCase();
  state.lastKnownAddress = state.address;
  localStorage.setItem(CONNECTED_FLAG_KEY, '1');
  localStorage.setItem(LAST_ADDRESS_KEY, state.address);
  trackEvent('wallet_changed', { address: short(state.address) });
  renderState();
  refreshState({ silent: true });
}

function onDisconnect() {
  trackEvent('wallet_disconnected', {});
  state.address = null;
  localStorage.removeItem(CONNECTED_FLAG_KEY);
  renderState();
}

function getLastKnownAddress() {
  const value = String(localStorage.getItem(LAST_ADDRESS_KEY) || '').trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(value)) return value;
  return null;
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

function isUserRejectedError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === 4001 ||
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('rejected the request') ||
    message.includes('cancelled')
  );
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[daily-streak] ${message}`);
}

async function notifyMiniAppReady(attempt = 0) {
  const sdkRef = await loadMiniAppSdk();
  if (sdkRef?.sdk?.actions?.ready && typeof sdkRef.sdk.actions.ready === 'function') {
    try {
      await sdkRef.sdk.actions.ready();
      trackEvent('miniapp_ready_sent', {
        sdkProvider: sdkRef.provider,
        attempt
      });
      return true;
    } catch (error) {
      if (attempt >= 8) {
        trackEvent('miniapp_ready_failed', { reason: safeErrorMessage(error) });
        return false;
      }
    }
  }

  if (attempt >= 8) return false;
  await sleep(300);
  return notifyMiniAppReady(attempt + 1);
}

async function loadMiniAppSdk() {
  const globalSdk = getGlobalMiniAppSdk();
  if (globalSdk) return globalSdk;

  if (!miniAppSdkModulePromise) {
    miniAppSdkModulePromise = import('https://esm.sh/@farcaster/miniapp-sdk')
      .then((module) => {
        if (module?.sdk?.actions?.ready && typeof module.sdk.actions.ready === 'function') {
          return { provider: 'esm:@farcaster/miniapp-sdk', sdk: module.sdk };
        }
        return null;
      })
      .catch(() => null);
  }

  return miniAppSdkModulePromise;
}

function getGlobalMiniAppSdk() {
  const candidates = [
    { provider: 'miniapp.sdk', sdk: globalThis?.miniapp?.sdk },
    { provider: 'frame.sdk', sdk: globalThis?.frame?.sdk },
    { provider: 'farcaster.sdk', sdk: globalThis?.farcaster?.sdk },
    { provider: 'fc.sdk', sdk: globalThis?.fc?.sdk },
    { provider: 'window.sdk', sdk: globalThis?.sdk }
  ];

  for (const candidate of candidates) {
    if (candidate.sdk?.actions?.ready && typeof candidate.sdk.actions.ready === 'function') {
      return candidate;
    }
  }

  return null;
}

function safeErrorMessage(error) {
  const message = String(error?.message || 'unknown_error');
  return message.slice(0, 180);
}

function trackEvent(event, payload = {}) {
  const body = {
    event,
    source: 'client_ui',
    playerId,
    address: state.address || state.lastKnownAddress || null,
    payload
  };

  fetch(ANALYTICS_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-player-id': playerId,
      ...(state.address ? { 'x-wallet-address': state.address } : {})
    },
    body: JSON.stringify(body),
    keepalive: true
  }).catch(() => {});
}
