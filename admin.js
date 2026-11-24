'use strict';
const $ = id => document.getElementById(id);
let csrfToken = '';
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

function setStatus(id, message, isError = false) {
  const node = $(id);
  node.textContent = message;
  node.style.color = isError ? '#ff9aa8' : 'var(--cyan)';
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
}

async function loadOverview() {
  const data = await api('/api/admin/overview');
  $('metricTools').textContent = data.catalog.total;
  $('metricReceived').textContent = data.stats.received || 0;
  $('metricReplied').textContent = data.stats.replied || 0;
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
  $('aiEnabled').checked = Boolean(s.aiEnabled);
  $('aiEndpoint').value = s.aiEndpoint;
  $('aiModel').value = s.aiModel;
  $('fallbackPrefix').value = s.fallbackPrefix;
  $('webhookUrl').textContent = 'http://app:3000/webhooks/tiktok';
  $('categoryRows').innerHTML = data.catalog.categories.map(category => `
    <article class="category-row"><strong>${escapeHtml(category.name)}</strong><span>${category.count} TOOLS</span></article>
  `).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
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

$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const body = {
    bridgeBaseUrl: $('bridgeBaseUrl').value.trim(),
    bridgeApiToken: $('bridgeApiToken').value,
    webhookSecret: $('webhookSecret').value,
    clearBridgeToken: $('clearBridgeToken').checked,
    clearWebhookSecret: $('clearWebhookSecret').checked,
    publicBaseUrl: $('publicBaseUrl').value.trim(),
    aiEnabled: $('aiEnabled').checked,
    aiEndpoint: $('aiEndpoint').value.trim(),
    aiModel: $('aiModel').value.trim(),
    fallbackPrefix: $('fallbackPrefix').value.trim()
  };
  try {
    await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(body) });
    $('bridgeApiToken').value = '';
    $('webhookSecret').value = '';
    $('clearBridgeToken').checked = false;
    $('clearWebhookSecret').checked = false;
    setStatus('settingsStatus', 'Konfigurasi berhasil disimpan di server.');
    await loadOverview();
  } catch (error) { setStatus('settingsStatus', error.message, true); }
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
  setStatus('settingsStatus', 'Mengirim permintaan uji ke AI gratis...');
  try {
    const data = await api('/api/admin/test-ai', { method: 'POST', body: '{}' });
    setStatus('settingsStatus', `${data.note} ${data.answer}` , !data.ok);
  } catch (error) { setStatus('settingsStatus', error.message, true); }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); }
  finally { await refreshState(); }
});

refreshState().catch(error => {
  show('authPanel');
  $('authTitle').textContent = 'Panel belum siap';
  $('authDescription').textContent = error.message;
});
