'use strict';
const $ = id => document.getElementById(id);
let csrfToken = '';
let currentBotEnabled = false;
let currentTikTokRiskAccepted = false;
let refreshTimer = null;

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (${response.status})`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function number(value) { return new Intl.NumberFormat('id-ID').format(Number(value) || 0); }
function setPill(id, text, state) {
  const node = $(id);
  node.textContent = text;
  node.className = `state-pill${state ? ` ${state}` : ''}`;
}
function showGate() {
  $('loginGate').classList.remove('hidden');
  $('dashboardContent').classList.add('hidden');
}
function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waktu tidak diketahui';
  return date.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function renderLogs(logs) {
  const list = $('activityList');
  const entries = Array.isArray(logs) ? logs : [];
  if (!entries.length) {
    list.innerHTML = '<div class="activity-empty">Belum ada aktivitas yang tercatat.</div>';
    return;
  }
  list.innerHTML = entries.slice(0, 30).map(item => `
    <article class="activity-item" data-type="${escapeHtml(item.type)}">
      <span class="activity-dot" aria-hidden="true"></span>
      <span class="activity-message">${escapeHtml(item.message)}</span>
      <time class="activity-time" datetime="${escapeHtml(item.at)}">${escapeHtml(formatTime(item.at))}</time>
    </article>
  `).join('');
}

function renderOverview(data) {
  const stats = data.stats || {};
  const bot = data.bot || {};
  const bridge = data.bridge || {};
  const ai = data.ai || {};
  const storage = data.storage || {};
  const platforms = data.platforms || {};
  currentBotEnabled = Boolean(bot.enabled);
  currentTikTokRiskAccepted = Boolean(platforms.tiktok?.riskAcceptedAt);
  const setPlatformTag = (id, label, kind) => { const node = $(id); if (!node) return; node.textContent = label; node.className = `platform-status-tag ${kind || ''}`; };
  setPlatformTag('menuTikTokStatus', platforms.tiktok?.enabled ? 'BOT AKTIF' : 'BOT NONAKTIF', platforms.tiktok?.enabled ? 'good' : 'wait');
  setPlatformTag('menuTelegramStatus', platforms.telegram?.connected ? 'TERHUBUNG' : platforms.telegram?.enabled ? 'MENUNGGU' : 'BELUM AKTIF', platforms.telegram?.connected ? 'good' : 'wait');
  setPlatformTag('menuWhatsAppStatus', platforms.whatsapp?.connected ? 'TERHUBUNG' : platforms.whatsapp?.enabled ? 'MENYAMBUNG' : 'BELUM DITAUTKAN', platforms.whatsapp?.connected ? 'good' : 'wait');

  $('metricReceived').textContent = number(stats.received);
  $('metricReplied').textContent = number(stats.replied);
  $('metricAiReplies').textContent = number(stats.aiReplies);
  $('metricOutputs').textContent = number(stats.outputs);
  $('metricSessions').textContent = number(bot.activeSessions);

  const statusText = !currentBotEnabled ? 'BOT OFF' : (bridge.connected ? 'BOT ON' : 'BOT ON / MENUNGGU BRIDGE');
  $('botStatusText').textContent = statusText;
  $('botSignal').className = `bot-signal ${!currentBotEnabled ? '' : bridge.connected ? 'on' : 'wait'}`;
  $('botStatusNote').textContent = !currentBotEnabled
    ? 'Webhook diterima tetapi pesan baru tidak diproses sampai bot dinyalakan.'
    : bridge.connected
      ? 'Bot aktif dan endpoint bridge merespons. DM nyata tetap perlu diuji.'
      : 'Bot aktif, tetapi bridge belum siap. Periksa koneksi di konfigurasi.';
  $('botToggle').textContent = currentBotEnabled ? 'Matikan bot' : 'Nyalakan bot';
  $('botToggle').className = `btn ${currentBotEnabled ? '' : 'primary'} bot-toggle`;
  $('botToggle').disabled = false;

  setPill('bridgePill', bridge.connected ? 'TERHUBUNG' : (bridge.configured ? 'BELUM SIAP' : 'BELUM DIATUR'), bridge.connected ? 'good' : 'bad');
  $('bridgeNote').textContent = bridge.note || 'Status bridge belum diketahui.';
  $('bridgeAddress').textContent = data.settings?.bridgeBaseUrl || 'Belum diatur';
  const webhookReady = Boolean(data.settings?.webhookSecretSet && data.settings?.bridgeTokenSet);
  setPill('webhookPill', webhookReady ? 'TERKONFIGURASI' : 'BELUM SIAP', webhookReady ? 'good' : 'wait');
  $('webhookAddress').textContent = `${location.host}${bot.webhookPath || '/webhooks/tiktok'}`;
  $('storageNote').textContent = `${storage.location || 'APP_DATA_DIR'} menyimpan konfigurasi, sesi tool, indeks hasil, dan log. Sesi akun TikTok bridge berada di volume terpisah.`;
  $('storedResults').textContent = number(bot.storedResults);

  setPill('aiPill', !ai.enabled ? 'NONAKTIF' : 'AKTIF', ai.enabled ? 'good' : 'bad');
  $('aiProvider').textContent = ai.provider || 'AI tidak diketahui';
  $('aiModel').textContent = ai.model || '-';
  $('aiNote').textContent = !ai.enabled
    ? 'AI fallback dimatikan. Pesan yang tidak cocok tidak akan mendapat jawaban AI.'
    : ai.mode === 'custom'
      ? `Mode API manual aktif. API key ${ai.apiKeySet ? 'tersimpan di server' : 'belum diisi'}.`
      : 'Mode otomatis: Pollinations lalu Kilo, LLM7, dan AI Horde sebagai cadangan gratis tanpa API key pengguna. Kuota dan waktu antre bisa berubah.';

  renderLogs(data.logs);
  $('lastRefresh').textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · pembaruan otomatis 15 detik`;
}

async function refreshOverview() {
  const data = await api('/api/admin/overview');
  renderOverview(data);
}

async function initialize() {
  try {
    const state = await api('/api/admin/state');
    csrfToken = state.csrfToken || '';
    if (!state.authenticated) {
      showGate();
      return;
    }
    $('loginGate').classList.add('hidden');
    $('dashboardContent').classList.remove('hidden');
    await refreshOverview();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => refreshOverview().catch(error => console.warn('[bot-dashboard]', error.message)), 15000);
  } catch (error) {
    showGate();
    $('loginGate').querySelector('.muted').textContent = error.message;
  }
}

$('botToggle').addEventListener('click', async () => {
  if (!currentBotEnabled && !currentTikTokRiskAccepted) {
    window.location.href = '/admin#platform=tiktok';
    return;
  }
  $('botToggle').disabled = true;
  $('botToggle').textContent = 'Menyimpan...';
  try {
    await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ botEnabled: !currentBotEnabled }) });
    await refreshOverview();
  } catch (error) {
    $('botToggle').disabled = false;
    $('botToggle').textContent = currentBotEnabled ? 'Matikan bot' : 'Nyalakan bot';
    $('botStatusNote').textContent = error.message;
  }
});

$('refreshBtn').addEventListener('click', async () => {
  $('refreshBtn').disabled = true;
  $('refreshBtn').textContent = 'Memperbarui...';
  try { await refreshOverview(); }
  catch (error) { $('botStatusNote').textContent = error.message; }
  finally { $('refreshBtn').disabled = false; $('refreshBtn').textContent = 'Perbarui status'; }
});

initialize();
