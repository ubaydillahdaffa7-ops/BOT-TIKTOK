import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, getDb, logActivity, persist } from './store.js';
import { handleExternalMessage, sendTikTokText } from './bot.js';

const telegramState = {
  running: false,
  connected: false,
  username: '',
  displayName: '',
  lastError: '',
  lastUpdateAt: null
};
let telegramLoopPromise = null;
let telegramAbort = null;

const whatsappState = {
  active: false,
  connected: false,
  status: 'not-connected',
  qr: '',
  pairingCode: '',
  phoneNumber: '',
  displayName: '',
  lastError: ''
};
let whatsappSocket = null;
let whatsappReconnectTimer = null;
let whatsappStartPromise = null;
let whatsappAuthDir = path.join(DATA_DIR, 'whatsapp-auth');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const textOf = message => message?.conversation
  || message?.extendedTextMessage?.text
  || message?.imageMessage?.caption
  || message?.videoMessage?.caption
  || message?.documentMessage?.caption
  || '';

async function telegramRequest(method, params = {}, options = {}) {
  const token = getDb().settings.telegramBotToken;
  if (!token) throw new Error('Token Bot Telegram belum disimpan.');
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const hasBody = options.body !== undefined;
  const response = await fetch(hasBody ? url : `${url}?${new URLSearchParams(params)}`, {
    method: hasBody ? 'POST' : 'GET',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal || AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    const message = payload.description || `Telegram API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.result;
}

export async function testTelegramToken(tokenOverride = '') {
  const token = String(tokenOverride || getDb().settings.telegramBotToken || '').trim();
  if (!token) throw new Error('Masukkan token Telegram terlebih dahulu.');
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: AbortSignal.timeout(10_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error(data.description || `Token ditolak (HTTP ${response.status}).`);
  const webhookResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
    signal: AbortSignal.timeout(10_000)
  });
  const webhookData = await webhookResponse.json().catch(() => ({}));
  return { bot: data.result, webhook: webhookData.ok ? webhookData.result : null };
}

export async function sendTelegramText(chatId, text) {
  const value = String(text || '').slice(0, 3900);
  return telegramRequest('sendMessage', {}, { body: { chat_id: String(chatId), text: value, disable_web_page_preview: false } });
}

async function processTelegramUpdate(update) {
  const message = update?.message || update?.edited_message;
  if (!message || message.from?.is_bot || !message.chat?.id) return;
  // Keep the default bot private-chat only; group replies need separate opt-in and moderation.
  if (message.chat.type !== 'private') return;
  const text = String(textOf(message) || '').trim();
  if (!text) return;
  await handleExternalMessage({
    platform: 'telegram',
    conversationId: String(message.chat.id),
    senderId: String(message.from?.id || message.chat.id),
    messageId: `telegram:${update.update_id}`,
    text,
    messageType: message.photo || message.document ? 'media' : 'text'
  }, (chatId, reply) => sendTelegramText(chatId, reply));
}

export async function stopTelegramPolling() {
  telegramState.running = false;
  telegramState.connected = false;
  telegramAbort?.abort();
  telegramAbort = null;
  if (telegramLoopPromise) await Promise.race([telegramLoopPromise.catch(() => {}), sleep(1500)]);
  telegramLoopPromise = null;
  telegramState.lastError = '';
}

export async function startTelegramPolling() {
  if (!getDb().settings.telegramBotToken) throw new Error('Simpan token Telegram terlebih dahulu.');
  if (telegramLoopPromise) return getTelegramStatus();

  const identity = await testTelegramToken();
  if (identity.webhook?.url) {
    // Polling and an outgoing webhook cannot be active at the same time.
    await telegramRequest('deleteWebhook', {}, { body: { drop_pending_updates: false } });
  }

  telegramState.username = identity.bot.username || '';
  telegramState.displayName = [identity.bot.first_name, identity.bot.last_name].filter(Boolean).join(' ');
  telegramState.lastError = '';
  telegramState.running = true;
  telegramLoopPromise = (async () => {
    while (telegramState.running) {
      try {
        telegramAbort = new AbortController();
        const offset = Number(getDb().settings.telegramUpdateOffset || 0);
        const result = await telegramRequest('getUpdates', {
          offset: String(offset),
          timeout: '20',
          allowed_updates: JSON.stringify(['message', 'edited_message'])
        }, { signal: telegramAbort.signal });
        telegramState.connected = true;
        telegramState.lastError = '';
        let retryUpdate = false;
        for (const update of Array.isArray(result) ? result : []) {
          try { await processTelegramUpdate(update); }
          catch (error) {
            telegramState.lastError = error?.message || 'Gagal memproses pesan Telegram.';
            console.warn('[telegram-message]', telegramState.lastError);
            retryUpdate = true;
            break;
          }
          getDb().settings.telegramUpdateOffset = Number(update.update_id) + 1;
          telegramState.lastUpdateAt = new Date().toISOString();
          await persist();
        }
        if (retryUpdate) await sleep(3000);
      } catch (error) {
        if (!telegramState.running && error?.name === 'AbortError') break;
        telegramState.connected = false;
        telegramState.lastError = error?.message || 'Koneksi Telegram terputus.';
        console.warn('[telegram-poll]', telegramState.lastError);
        await sleep(4000);
      } finally {
        telegramAbort = null;
      }
    }
    telegramState.running = false;
    telegramState.connected = false;
  })().finally(() => { telegramLoopPromise = null; });

  logActivity('telegram_started', `Bot Telegram ${telegramState.username || ''} mulai polling`);
  await persist();
  return getTelegramStatus();
}

export function getTelegramStatus() {
  const settings = getDb().settings;
  return {
    enabled: settings.platforms?.telegram?.enabled === true,
    tokenSet: Boolean(settings.telegramBotToken),
    running: telegramState.running,
    connected: telegramState.connected,
    username: telegramState.username,
    displayName: telegramState.displayName,
    lastError: telegramState.lastError,
    lastUpdateAt: telegramState.lastUpdateAt
  };
}

async function whatsappDependencies() {
  const baileys = await import('@whiskeysockets/baileys');
  const qrcode = await import('qrcode');
  return {
    makeWASocket: baileys.default,
    useMultiFileAuthState: baileys.useMultiFileAuthState,
    DisconnectReason: baileys.DisconnectReason,
    Browsers: baileys.Browsers,
    fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
    QRCode: qrcode.default || qrcode
  };
}

function normalizePhoneNumber(value) {
  const number = String(value || '').replace(/\D/g, '');
  if (number.length < 8 || number.length > 15) throw new Error('Nomor harus memakai kode negara, 8–15 digit. Contoh Indonesia: 6281234567890.');
  return number;
}

export async function startWhatsApp(phoneNumber = '') {
  if (whatsappStartPromise) return whatsappStartPromise;
  if (whatsappSocket && (whatsappState.connected || whatsappState.status === 'waiting-for-link' || whatsappState.status === 'connecting')) return getWhatsAppStatus();
  whatsappStartPromise = (async () => {
    const normalizedPhone = phoneNumber ? normalizePhoneNumber(phoneNumber) : '';
    const deps = await whatsappDependencies();
    const latest = await deps.fetchLatestBaileysVersion?.().catch(() => null);
    await fs.mkdir(whatsappAuthDir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await deps.useMultiFileAuthState(whatsappAuthDir);
    whatsappState.active = true;
    whatsappState.status = 'connecting';
    whatsappState.lastError = '';
    whatsappState.qr = '';
    whatsappState.pairingCode = '';
    if (normalizedPhone) whatsappState.phoneNumber = normalizedPhone;

    const socket = deps.makeWASocket({
      auth: state,
      ...(latest?.version ? { version: latest.version } : {}),
      printQRInTerminal: false,
      browser: deps.Browsers?.ubuntu ? deps.Browsers.ubuntu('DAFZZ Bot') : undefined,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });
    whatsappSocket = socket;
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', async update => {
      if (update.qr) {
        whatsappState.status = 'waiting-for-link';
        try { whatsappState.qr = await deps.QRCode.toDataURL(update.qr, { width: 280, margin: 1, errorCorrectionLevel: 'M' }); }
        catch (error) { whatsappState.lastError = `QR gagal dibuat: ${error.message}`; }
      }
      if (update.connection === 'open') {
        whatsappState.connected = true;
        whatsappState.status = 'connected';
        whatsappState.qr = '';
        whatsappState.pairingCode = '';
        whatsappState.displayName = socket.user?.name || socket.user?.verifiedName || '';
        whatsappState.lastError = '';
        logActivity('whatsapp_connected', 'Koneksi WhatsApp berhasil ditautkan');
        await persist();
      }
      if (update.connection === 'close') {
        whatsappState.connected = false;
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        if (statusCode === deps.DisconnectReason?.loggedOut) {
          whatsappState.active = false;
          whatsappState.status = 'logged-out';
          whatsappState.lastError = 'Sesi WhatsApp sudah keluar. Hapus sesi lalu tautkan ulang.';
        } else if (whatsappState.active) {
          whatsappState.status = 'reconnecting';
          whatsappState.lastError = 'Koneksi terputus. Mencoba menyambung kembali.';
          if (whatsappReconnectTimer) clearTimeout(whatsappReconnectTimer);
          whatsappReconnectTimer = setTimeout(() => {
            whatsappReconnectTimer = null;
            whatsappSocket = null;
            startWhatsApp().catch(error => { whatsappState.lastError = error.message; whatsappState.status = 'error'; });
          }, 5000);
        } else {
          whatsappState.status = 'disconnected';
        }
      }
    });
    socket.ev.on('messages.upsert', async event => {
      if (event.type !== 'notify') return;
      for (const item of event.messages || []) {
        const jid = item.key?.remoteJid || '';
        if (!jid || item.key?.fromMe || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue;
        const body = item.message || {};
        const messageText = String(textOf(body) || '').trim();
        if (!messageText) continue;
        try {
          await handleExternalMessage({
            platform: 'whatsapp',
            conversationId: jid,
            senderId: item.key?.participant || jid,
            messageId: `whatsapp:${item.key?.id || `${jid}:${item.messageTimestamp || Date.now()}`}`,
            text: messageText,
            messageType: body.imageMessage || body.documentMessage || body.videoMessage ? 'media' : 'text'
          }, (chatId, reply) => sendWhatsAppText(chatId, reply));
        } catch (error) {
          whatsappState.lastError = error?.message || 'Gagal memproses pesan WhatsApp.';
          console.warn('[whatsapp-message]', whatsappState.lastError);
        }
      }
    });

    if (whatsappState.phoneNumber && !state.creds.registered) {
      whatsappState.pairingCode = await socket.requestPairingCode(whatsappState.phoneNumber);
      whatsappState.status = 'waiting-for-link';
    }
    return getWhatsAppStatus();
  })().catch(error => {
    whatsappState.active = false;
    whatsappState.connected = false;
    whatsappState.status = 'error';
    whatsappState.lastError = error?.message || 'Konektor WhatsApp gagal dimulai.';
    throw error;
  }).finally(() => { whatsappStartPromise = null; });
  return whatsappStartPromise;
}

export async function sendWhatsAppText(chatId, text) {
  if (!whatsappSocket || !whatsappState.connected) throw new Error('WhatsApp belum terhubung. Tautkan akun terlebih dahulu.');
  return whatsappSocket.sendMessage(String(chatId), { text: String(text || '').slice(0, 3900) });
}

export async function stopWhatsApp({ logout = false } = {}) {
  whatsappState.active = false;
  if (whatsappReconnectTimer) clearTimeout(whatsappReconnectTimer);
  whatsappReconnectTimer = null;
  const socket = whatsappSocket;
  whatsappSocket = null;
  if (socket) {
    try {
      if (logout) await socket.logout();
      else socket.end(undefined);
    } catch { /* close is best-effort */ }
  }
  whatsappState.connected = false;
  whatsappState.qr = '';
  whatsappState.pairingCode = '';
  whatsappState.status = logout ? 'logged-out' : 'disconnected';
  if (logout) {
    await fs.rm(whatsappAuthDir, { recursive: true, force: true });
    whatsappState.phoneNumber = '';
    whatsappState.displayName = '';
  }
  return getWhatsAppStatus();
}

export function getWhatsAppStatus() {
  return {
    enabled: getDb().settings.platforms?.whatsapp?.enabled === true,
    connected: whatsappState.connected,
    status: whatsappState.status,
    qr: whatsappState.qr,
    pairingCode: whatsappState.pairingCode,
    phoneNumber: whatsappState.phoneNumber,
    displayName: whatsappState.displayName,
    lastError: whatsappState.lastError,
    sessionStored: Boolean(whatsappState.connected || whatsappState.active)
  };
}

export async function sendPlatformText(platform, chatId, text, idempotencyKey = '') {
  if (platform === 'tiktok') return sendTikTokText(chatId, text, idempotencyKey);
  if (platform === 'telegram') return sendTelegramText(chatId, text);
  if (platform === 'whatsapp') return sendWhatsAppText(chatId, text);
  throw new Error(`Platform tidak didukung: ${platform}`);
}

export async function startConfiguredConnectors() {
  const settings = getDb().settings;
  if (settings.platforms?.telegram?.enabled && settings.telegramBotToken) {
    startTelegramPolling().catch(error => {
      telegramState.lastError = error?.message || 'Bot Telegram gagal dimulai.';
      console.warn('[telegram-start]', telegramState.lastError);
    });
  }
  if (settings.platforms?.whatsapp?.enabled) {
    startWhatsApp().catch(error => console.warn('[whatsapp-start]', error?.message || error));
  }
}
