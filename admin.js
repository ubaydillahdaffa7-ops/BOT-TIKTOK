'use strict';
const $ = id => document.getElementById(id);
let csrfToken = '';
let platformState = {};
let pendingRiskAction = null;
const riskAcknowledgements = new Set();
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (${response.status})`);
  return data;
}

function setAIFields() {
  const custom = $('aiMode').value === 'custom';
  $('aiCustomFields').classList.toggle('hidden', !custom);
  $('pollinationsInfo').classList.toggle('hidden', custom);
  $('aiEndpoint').required = custom;
  $('aiModel').required = custom;
}

function setStatus(id, message, isError = false) {
  const node = $(id);
  node.textContent = message;
  node.style.color = isError ? '#ff9aa8' : 'var(--cyan)';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function setPill(id, label, state) {
  const pill = $(id);
  pill.textContent = label;
  pill.className = `status-pill${state ? ` ${state}` : ''}`;
}

const VALID_PLATFORMS = new Set(['tiktok', 'whatsapp', 'telegram']);
function readRequestedPlatform() {
  const requested = new URLSearchParams(location.hash.replace(/^#/, '')).get('platform');
  return VALID_PLATFORMS.has(requested) ? requested : 'tiktok';
}

function selectPlatform(platform, options = {}) {
  if (!VALID_PLATFORMS.has(platform)) return;
  document.querySelectorAll('[data-platform-nav]').forEach(button => {
    const active = button.dataset.platformNav === platform;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-platform-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.platformPanel !== platform);
    panel.setAttribute('aria-hidden', String(panel.dataset.platformPanel !== platform));
  });
  const panel = document.querySelector(`[data-platform-panel="${platform}"]`);
  if (options.updateHash !== false && location.hash !== `#platform=${platform}`) {
    history.replaceState(null, '', `${location.pathname}${location.search}#platform=${platform}`);
  }
  if (options.scroll !== false && panel && !$('dashboard').classList.contains('hidden')) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

document.querySelectorAll('[data-platform-nav]').forEach(button => {
  button.addEventListener('click', () => selectPlatform(button.dataset.platformNav));
});
window.addEventListener('hashchange', () => {
  if (!$('dashboard').classList.contains('hidden')) selectPlatform(readRequestedPlatform(), { updateHash: false });
});

function updateRiskProgress() {
  const count = riskAcknowledgements.size;
  $('riskProgressText').textContent = `${count} dari 5 dipahami`;
  $('riskProgressBar').style.width = `${count * 20}%`;
  $('confirmRiskBtn').disabled = count !== 5;
}

function openRiskGate(platform, action) {
  pendingRiskAction = { platform, action };
  riskAcknowledgements.clear();
  document.querySelectorAll('.risk-ack').forEach(button => {
    button.disabled = false;
    button.classList.remove('acknowledged');
    button.textContent = 'Paham';
  });
  updateRiskProgress();
  $('riskIntro').textContent = `Platform yang akan disambungkan: ${platform.toUpperCase()}. Baca setiap peringatan, lalu tekan tombol Paham di bagian tersebut.`;
  show('riskBackdrop');
  $('riskDialog').scrollTop = 0;
  $('riskDialog').querySelector('.risk-ack')?.focus();
}

function closeRiskGate(runAction = false) {
  hide('riskBackdrop');
  const pending = pendingRiskAction;
  pendingRiskAction = null;
  riskAcknowledgements.clear();
  if (runAction && pending?.action) pending.action();
}

document.querySelectorAll('.risk-ack').forEach((button, index) => {
  button.addEventListener('click', () => {
    riskAcknowledgements.add(index);
    button.disabled = true;
    button.classList.add('acknowledged');
    button.textContent = '✓ Paham';
    updateRiskProgress();
  });
});
$('confirmRiskBtn').addEventListener('click', () => {
  if (riskAcknowledgements.size !== 5) return;
  closeRiskGate(true);
});
$('cancelRiskBtn').addEventListener('click', () => closeRiskGate(false));
$('cancelRiskBottomBtn').addEventListener('click', () => closeRiskGate(false));
$('riskBackdrop').addEventListener('click', event => {
  if (event.target === $('riskBackdrop')) closeRiskGate(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('riskBackdrop').classList.contains('hidden')) closeRiskGate(false);
});

async function refreshPlatformStates() {
  const data = await api('/api/admin/platforms/status');
  platformState.telegram = data.telegram || {};
  platformState.whatsapp = data.whatsapp || {};
  renderTelegramStatus(platformState.telegram);
  renderWhatsAppStatus(platformState.whatsapp);
}

function renderTelegramStatus(status) {
  if (!status) return;
  const ready = Boolean(status.connected);
  setPill('telegramStatus', ready ? 'TERHUBUNG' : (status.enabled ? 'MENUNGGU' : 'BELUM AKTIF'), ready ? 'good' : status.lastError ? 'bad' : 'wait');
  $('telegramNote').textContent = ready
    ? `Bot @${status.username || 'Telegram'} sedang menerima pesan pribadi.`
    : status.lastError || (status.tokenSet ? 'Token tersimpan. Aktifkan bot untuk mulai menerima pesan.' : 'Token belum disimpan dan bot belum terhubung.');
  $('telegramUsername').textContent = status.username ? `@${status.username}` : 'Belum terdeteksi';
  if ($('telegramEnabled') && !$('telegramEnabled').dataset.dirty) $('telegramEnabled').checked = Boolean(status.enabled);
}

function renderWhatsAppStatus(status) {
  if (!status) return;
  const label = status.connected ? 'TERHUBUNG' : status.status === 'waiting-for-link' ? 'MENUNGGU TAUTAN' : status.enabled ? 'MENYAMBUNG' : 'BELUM DITAUTKAN';
  setPill('whatsappStatus', label, status.connected ? 'good' : status.lastError ? 'bad' : 'wait');
  $('whatsappNote').textContent = status.connected
    ? 'Sesi WhatsApp aktif. Bot siap menerima pesan pribadi.'
    : status.lastError || (status.status === 'waiting-for-link' ? 'Selesaikan tautan pada aplikasi WhatsApp di ponsel.' : 'Belum ada sesi WhatsApp yang aktif.');
  $('whatsappAccount').textContent = status.displayName || status.phoneNumber || (status.connected ? 'Akun tertaut' : 'Belum terdeteksi');
  if (status.pairingCode || status.qr) {
    show('whatsappPairResult');
    $('whatsappPairCode').textContent = status.pairingCode || 'Gunakan QR di samping';
    if (status.qr) {
      $('whatsappQr').src = status.qr;
      show('whatsappQr');
    } else {
      $('whatsappQr').removeAttribute('src');
      hide('whatsappQr');
    }
  } else if (!status.connected) {
    hide('whatsappPairResult');
  } else {
    hide('whatsappPairResult');
  }
}

async function loadOverview() {
  const data = await api('/api/admin/overview');
  $('metricTools').textContent = data.catalog.total;
  $('metricReceived').textContent = data.stats.received || 0;
  $('metricReplied').textContent = data.stats.replied || 0;
  $('metricAiReplies').textContent = data.stats.aiReplies || 0;
  $('metricOutputs').textContent = data.stats.outputs || 0;
  const bridgePill = $('bridgeStatus');
  bridgePill.textContent = data.bridge.connected ? 'TERHUBUNG' : (data.bridge.configured ? 'BELUM SIAP' : 'BELUM DIATUR');
  bridgePill.className = `status-pill ${data.bridge.connected ? 'good' : 'bad'}`;
  $('bridgeNote').textContent = data.bridge.note;
  const s = data.settings;
  $('bridgeBaseUrl').value = s.bridgeBaseUrl || 'http://tiktok-bridge:8000';
  $('bridgeApiToken').value = '';
  $('webhookSecret').value = '';
  $('clearBridgeToken').checked = false;
  $('clearWebhookSecret').checked = false;
  $('publicBaseUrl').value = s.publicBaseUrl || '';
  $('botEnabled').checked = Boolean(s.botEnabled);
  $('aiEnabled').checked = Boolean(s.aiEnabled);
  $('aiMode').value = s.aiMode || 'pollinations';
  $('aiEndpoint').value = s.aiEndpoint || '';
  $('aiModel').value = s.aiModel || '';
  $('aiApiKey').value = '';
  $('clearAiApiKey').checked = false;
  $('pollinationsApiKey').value = '';
  $('clearPollinationsApiKey').checked = false;
  setAIFields();
  $('fallbackPrefix').value = s.fallbackPrefix || '';
  $('webhookUrl').textContent = `${location.host}/webhooks/tiktok`;
  $('categoryRows').innerHTML = data.catalog.categories.map(category => `
    <article class="category-row"><strong>${escapeHtml(category.name)}</strong><span>${category.count} TOOLS</span></article>
  `).join('');
  platformState.tiktok = data.platforms?.tiktok || {};
  platformState.telegram = data.platforms?.telegram || platformState.telegram;
  platformState.whatsapp = data.platforms?.whatsapp || platformState.whatsapp;
  renderTelegramStatus(platformState.telegram);
  renderWhatsAppStatus(platformState.whatsapp);
}

async function refreshState() {
  const state = await api('/api/admin/state');
  csrfToken = state.csrfToken;
  if (!state.authenticated) {
    show('authPanel'); hide('dashboard');
    if (state.setupRequired) {
      $('authTitle').textContent = 'Buat administrator';
      $('authDescription').textContent = 'Buat password admin pertama untuk mengunci halaman konfigurasi.';
      $('authHint').textContent = 'Password minimal 12 karakter. Simpan di tempat aman.';
      $('authSubmit').textContent = 'Buat administrator';
      $('setupTokenWrap').classList.toggle('hidden', !state.setupTokenRequired);
      $('setupToken').required = Boolean(state.setupTokenRequired);
      $('adminPassword').setAttribute('autocomplete', 'new-password');
    } else {
      $('authTitle').textContent = 'Masuk ke konfigurasi';
      $('authDescription').textContent = 'Masukkan password administrator DAFZZ.';
      $('authHint').textContent = 'Lima percobaan gagal akan mengunci login selama 15 menit.';
      $('authSubmit').textContent = 'Masuk';
      $('setupTokenWrap').classList.add('hidden');
      $('setupToken').required = false;
      $('adminPassword').setAttribute('autocomplete', 'current-password');
    }
    return;
  }
  hide('authPanel'); show('dashboard');
  await loadOverview();
  await refreshPlatformStates().catch(error => console.warn('[platform-status]', error.message));
  selectPlatform(readRequestedPlatform(), { updateHash: false, scroll: false });
}

async function saveTikTokSettings(body) {
  try {
    await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(body) });
    $('bridgeApiToken').value = '';
    $('webhookSecret').value = '';
    $('aiApiKey').value = '';
    $('clearAiApiKey').checked = false;
    $('pollinationsApiKey').value = '';
    $('clearPollinationsApiKey').checked = false;
    $('clearBridgeToken').checked = false;
    $('clearWebhookSecret').checked = false;
    setStatus('settingsStatus', 'Konfigurasi TikTok berhasil disimpan di server.');
    await loadOverview();
  } catch (error) { setStatus('settingsStatus', error.message, true); }
}

$('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const state = await api('/api/admin/state');
  csrfToken = state.csrfToken;
  const password = $('adminPassword').value;
  const setupToken = $('setupToken').value;
  const route = state.setupRequired ? '/api/admin/setup' : '/api/admin/login';
  try {
    await api(route, { method: 'POST', body: JSON.stringify({ password, setupToken }) });
    $('adminPassword').value = '';
    $('setupToken').value = '';
    setStatus('authStatus', 'Akses diterima.');
    await refreshState();
  } catch (error) { setStatus('authStatus', error.message, true); }
});

$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  const body = {
    bridgeBaseUrl: $('bridgeBaseUrl').value.trim(),
    bridgeApiToken: $('bridgeApiToken').value,
    webhookSecret: $('webhookSecret').value,
    clearBridgeToken: $('clearBridgeToken').checked,
    clearWebhookSecret: $('clearWebhookSecret').checked,
    publicBaseUrl: $('publicBaseUrl').value.trim(),
    botEnabled: $('botEnabled').checked,
    aiEnabled: $('aiEnabled').checked,
    aiMode: $('aiMode').value,
    aiEndpoint: $('aiEndpoint').value.trim(),
    aiModel: $('aiModel').value.trim(),
    aiApiKey: $('aiApiKey').value,
    clearAiApiKey: $('clearAiApiKey').checked,
    pollinationsApiKey: $('pollinationsApiKey').value,
    clearPollinationsApiKey: $('clearPollinationsApiKey').checked,
    fallbackPrefix: $('fallbackPrefix').value.trim()
  };
  const needsAcknowledgement = body.botEnabled && !platformState.tiktok?.riskAcceptedAt;
  if (needsAcknowledgement) {
    openRiskGate('TikTok', () => saveTikTokSettings({ ...body, riskAcknowledged: true }));
  } else {
    saveTikTokSettings(body);
  }
});

$('telegramEnabled').addEventListener('change', () => { $('telegramEnabled').dataset.dirty = '1'; });

$('telegramForm').addEventListener('submit', event => {
  event.preventDefault();
  const enabled = $('telegramEnabled').checked;
  const body = { token: $('telegramToken').value.trim(), enabled };
  const save = async riskAcknowledged => {
    setStatus('telegramFormStatus', enabled ? 'Menyimpan token dan mengaktifkan polling Telegram...' : 'Menyimpan pengaturan Telegram...');
    try {
      const data = await api('/api/admin/platforms/telegram/config', { method: 'POST', body: JSON.stringify({ ...body, riskAcknowledged }) });
      $('telegramToken').value = '';
      $('telegramEnabled').dataset.dirty = '';
      setStatus('telegramFormStatus', data.telegram.connected ? `Terhubung sebagai @${data.telegram.username}.` : 'Pengaturan disimpan. Memulai koneksi Telegram...');
      await refreshPlatformStates();
    } catch (error) { setStatus('telegramFormStatus', error.message, true); }
  };
  if (enabled && !platformState.telegram?.riskAcceptedAt) openRiskGate('Telegram', () => save(true));
  else save(false);
});

$('testTelegramBtn').addEventListener('click', async () => {
  setStatus('telegramFormStatus', 'Memeriksa token ke Telegram...');
  try {
    const data = await api('/api/admin/platforms/telegram/test', { method: 'POST', body: JSON.stringify({ token: $('telegramToken').value.trim() }) });
    setStatus('telegramFormStatus', `Token valid: @${data.bot.username || 'tanpa username'}. ${data.webhookActive ? 'Webhook lama terdeteksi; akan diganti ke polling saat bot diaktifkan.' : 'Polling siap digunakan.'}`);
  } catch (error) { setStatus('telegramFormStatus', error.message, true); }
});

$('pairWhatsAppBtn').addEventListener('click', () => {
  openRiskGate('WhatsApp', async () => {
    setStatus('whatsappFormStatus', 'Memulai koneksi WhatsApp. Menyiapkan kode tautan atau QR...');
    try {
      const data = await api('/api/admin/platforms/whatsapp/pair', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: $('whatsappPhoneNumber').value.trim(), riskAcknowledged: true })
      });
      renderWhatsAppStatus(data.whatsapp);
      setStatus('whatsappFormStatus', data.whatsapp.pairingCode ? 'Kode tautan sudah dibuat. Masukkan kode tersebut di WhatsApp.' : 'Koneksi dimulai. Jika QR belum terlihat, tekan Perbarui status.');
      await refreshPlatformStates();
    } catch (error) { setStatus('whatsappFormStatus', error.message, true); }
  });
});

$('refreshWhatsAppBtn').addEventListener('click', async () => {
  setStatus('whatsappFormStatus', 'Memeriksa status WhatsApp...');
  try { await refreshPlatformStates(); setStatus('whatsappFormStatus', 'Status WhatsApp diperbarui.'); }
  catch (error) { setStatus('whatsappFormStatus', error.message, true); }
});

$('logoutWhatsAppBtn').addEventListener('click', async () => {
  if (!confirm('Hapus sesi WhatsApp yang tersimpan dan putuskan tautan dari server?')) return;
  setStatus('whatsappFormStatus', 'Menghapus sesi WhatsApp...');
  try {
    await api('/api/admin/platforms/whatsapp/logout', { method: 'POST', body: '{}' });
    await refreshPlatformStates();
    setStatus('whatsappFormStatus', 'Sesi WhatsApp sudah dihapus.');
  } catch (error) { setStatus('whatsappFormStatus', error.message, true); }
});

$('testBridgeBtn').addEventListener('click', async () => {
  setStatus('settingsStatus', 'Menguji koneksi bridge...');
  try {
    const data = await api('/api/admin/test-bridge', { method: 'POST', body: '{}' });
    setStatus('settingsStatus', `Bridge siap. ${JSON.stringify(data.status).slice(0, 240)}`);
    await loadOverview();
  } catch (error) { setStatus('settingsStatus', error.message, true); }
});

$('testAiBtn').addEventListener('click', async () => {
  setStatus('settingsStatus', 'Menguji AI utama dan tiga layanan cadangan...');
  try {
    const data = await api('/api/admin/test-ai', { method: 'POST', body: '{}' });
    setStatus('settingsStatus', `${data.note} ${data.answer}`, !data.ok);
  } catch (error) { setStatus('settingsStatus', error.message, true); }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); }
  finally { await refreshState(); }
});

$('aiMode').addEventListener('change', setAIFields);

refreshState().catch(error => {
  show('authPanel');
  $('authTitle').textContent = 'Panel belum siap';
  $('authDescription').textContent = error.message;
});

// Keep QR and pairing status current while the administrator is looking at the panel.
setInterval(() => {
  if (!$('dashboard').classList.contains('hidden')) refreshPlatformStates().catch(() => {});
}, 4000);
