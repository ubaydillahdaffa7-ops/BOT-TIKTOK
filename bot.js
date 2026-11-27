import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, logActivity, persist, randomToken, pruneExpired } from './store.js';
import { askFreeAI, isFallbackAIResponse } from './ai.js';
import { handleBotCommand } from './bot-commands.js';

const tools = JSON.parse(await fs.readFile(path.resolve('tools.json'), 'utf8'));
const CATEGORIES = [
  ['ai-bot', 'AI & Bot Commands'],
  ['foto', 'Foto & Desain'],
  ['teks', 'Teks & Data'],
  ['file', 'Dokumen & File'],
  ['konverter', 'Konverter & Kalkulator'],
  ['keamanan', 'Keamanan & Privasi'],
  ['web', 'Web & Developer']
];

function publicBase() {
  const configured = getDb().settings.publicBaseUrl || process.env.APP_PUBLIC_URL;
  return String(configured || '').replace(/\/$/, '');
}

export function makePublicBase() { return publicBase(); }

let outgoingQueue = Promise.resolve();
let lastOutgoingAt = 0;

export function sendTikTokText(conversationId, text, idempotencyKey) {
  const operation = outgoingQueue.then(async () => {
    const wait = Math.max(0, 3100 - (Date.now() - lastOutgoingAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    const settings = getDb().settings;
    if (!settings.bridgeBaseUrl || !settings.bridgeApiToken) throw new Error('Bridge TikTok belum dikonfigurasi di halaman Admin.');
    const base = settings.bridgeBaseUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.bridgeApiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey || crypto.randomUUID()
      },
      body: JSON.stringify({ conversation_id: conversationId, text: String(text).slice(0, 3900) }),
      signal: AbortSignal.timeout(12_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Bridge TikTok menolak pesan (${response.status}): ${payload.detail || payload.message || 'permintaan gagal'}`);
    lastOutgoingAt = Date.now();
    return payload;
  });
  outgoingQueue = operation.catch(() => {});
  return operation;
}

function menuText() {
  return [
    'DAFZZ BOT',
    '401 ENTRI - 7 KATEGORI',
    '',
    ...CATEGORIES.map(([slug, name]) => { const count = tools.filter(tool => tool.category === slug).length; return `${name} - ${count} entri\nKetik .${slug}`; }),
    '',
    'Kategori AI & Bot Commands berisi Chat AI unggulan, 50 AI/Local Tools, dan 50 perintah bot.',
    'AI/Local Tools juga dapat dipanggil dari chat: ketik .ai-story teks atau .sentence-counter teks.',
    'Ketik .commands untuk melihat 50 perintah tambahan.',
    'Pilih kategori atau langsung ketik perintah tool.',
    'Contoh: .potong-gambar',
    'Ketik .help untuk bantuan.'
  ].join('\n');
}

function categoryText(categorySlug) {
  const group = tools.filter(tool => tool.category === categorySlug);
  if (categorySlug === 'ai-bot') return ['AI & BOT COMMANDS - 101 ENTRI', '', 'CHAT AI - .ai untuk bertanya langsung di chat', '50 AI & LOCAL TOOLS - tersedia di website dan chat dengan format .slug teks', 'Contoh: .ai-story ide cerita atau .sentence-counter teks', '50 BOT COMMANDS - ketik .commands untuk daftar lengkap', '', 'Catatan: .pin menghasilkan tautan pencarian. Pemrosesan dan pengiriman lampiran media belum diaktifkan pada konektor chat.'].join('\n');
  const name = CATEGORIES.find(([slug]) => slug === categorySlug)?.[1] || categorySlug;
  const lines = group.filter(tool => tool.group !== 'bot-command' && tool.group !== 'featured').map(tool => `.${tool.slug} - ${tool.name}`);
  return [`${name.toUpperCase()} - ${group.length} TOOLS`, '', ...lines, '', 'Ketik perintah tool yang dipilih.'].join('\n').slice(0, 3900);
}

function findTool(message) {
  const command = String(message).trim().toLowerCase().split(/\s+/)[0];
  if (!command.startsWith('.')) return null;
  const slug = command.slice(1);
  return tools.find(tool => tool.slug === slug && tool.group !== 'bot-command' && tool.group !== 'featured') || null;
}

function normalizedMessage(event) {
  const data = event?.data && typeof event.data === 'object' ? event.data : (event?.payload || {});
  const message = data?.message && typeof data.message === 'object'
    ? data.message
    : (event?.message && typeof event.message === 'object' ? event.message : data);
  const conversation = data?.conversation || message?.conversation || {};
  const sender = data?.sender || message?.sender || {};
  const content = message?.content;
  const textValue = message?.text
    ?? message?.body
    ?? (typeof content === 'string' ? content : content?.text ?? content?.body)
    ?? data?.text
    ?? event?.text
    ?? '';
  const conversationId = message?.conversation_id
    ?? message?.conversationId
    ?? message?.conv_id
    ?? data?.conversation_id
    ?? data?.conversationId
    ?? conversation?.id
    ?? '';
  const senderId = message?.sender_id
    ?? message?.senderId
    ?? message?.from_user_id
    ?? data?.sender_id
    ?? data?.senderId
    ?? sender?.id
    ?? '';
  const messageType = message?.message_type
    ?? message?.content_type
    ?? content?.type
    ?? data?.message_type
    ?? '';
  return {
    text: typeof textValue === 'string' ? textValue : '',
    conversationId: String(conversationId),
    senderId: String(senderId),
    messageType: String(messageType),
    eventName: String(event?.type || event?.event || event?.event_type || event?.name || event?.kind || ''),
    eventId: String(event?.id || '')
  };
}

function createRunUrl(token, slug) {
  const base = publicBase();
  if (!base) return '';
  return `${base}/run/${token}?tool=${encodeURIComponent(slug)}`;
}

async function startToolSession(message, tool, eventId, sendText) {
  const db = getDb();
  const token = randomToken(24);
  const runUrl = createRunUrl(token, tool.slug);
  if (!runUrl) {
    await sendText(message.conversationId,
      `Tool ${tool.name} siap digunakan, tetapi alamat website belum diatur. Buka Konfigurasi Bot lalu isi URL publik HTTPS terlebih dahulu.`,
      `${eventId}:missing-url`);
    return;
  }
  db.sessions[token] = {
    token,
    platform: message.platform || 'tiktok',
    senderId: message.senderId,
    conversationId: message.conversationId,
    toolSlug: tool.slug,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    state: 'waiting-for-browser-result'
  };
  db.stats.toolLinks += 1;
  await persist();
  const reply = [
    `DAFZZ - ${tool.name.toUpperCase()}`,
    tool.description,
    '',
    'Buka halaman tool berikut. Kamu bisa memilih file atau memasukkan teks di halaman tersebut.',
    runUrl,
    '',
    'Setelah proses selesai, hasil akan dikirim kembali ke chat ini.',
    'Tautan sesi berlaku 24 jam.'
  ].join('\n');
  await sendText(message.conversationId, reply, `${eventId}:tool-link`);
}

async function processIncomingMessage(message, sendText) {
  const platform = message.platform || 'tiktok';
  const db = getDb();
  const enabled = platform === 'tiktok'
    ? db.settings.botEnabled !== false
    : db.settings.platforms?.[platform]?.enabled === true;
  if (!enabled) return { ignored: 'bot_disabled' };

  const rawText = String(message.text || '').trim();
  const id = String(message.messageId || crypto.createHash('sha256')
    .update(`${platform}:${message.conversationId}:${message.senderId}:${rawText}:${Date.now()}`)
    .digest('hex'));
  if (!message.conversationId) return { ignored: 'conversation_id_missing' };

  db.stats.received += 1;
  db.stats.byPlatform ||= { tiktok: 0, whatsapp: 0, telegram: 0 };
  db.stats.byPlatform[platform] = (db.stats.byPlatform[platform] || 0) + 1;
  logActivity('message_received', `Pesan masuk melalui ${platform}`);

  if (!rawText) {
    if (message.messageType === '8' || String(message.messageType || '').toLowerCase().includes('media')) {
      await sendText(message.conversationId,
        'Lampiran belum diproses langsung dari chat ini. Pilih perintah tool terlebih dahulu, lalu unggah file melalui halaman DAFZZ yang dikirim bot.',
        `${id}:media-notice`);
      db.stats.replied += 1;
      logActivity('bot_reply', `Pemberitahuan lampiran dikirim melalui ${platform}`);
    }
    await persist();
    return { ignored: 'empty_or_media' };
  }

  const command = rawText.toLowerCase();
  if (command === '.menu' || command === '.start') {
    await sendText(message.conversationId, menuText(), `${id}:menu`);
    db.stats.replied += 1;
    logActivity('bot_reply', `Menu utama dikirim melalui ${platform}`);
    await persist();
    return { replied: true, type: 'menu' };
  }
  if (command === '.help') {
    const text = [
      'PANDUAN DAFZZ BOT',
      '.menu - tampilkan tujuh kategori',
      '.ai pertanyaan - tanya langsung ke AI',
      '.ai-bot - ringkasan kategori AI & Bot Commands',
      '.commands - tampilkan 50 perintah tambahan',
      '.foto / .teks / .file / .konverter / .keamanan / .web - tampilkan daftar tools',
      '.cancel - batalkan sesi sebelumnya',
      '.info - informasi bot',
      '',
      'Gunakan nama perintah dengan titik di depan. Contoh: .word-to-pdf.'
    ].join('\n');
    await sendText(message.conversationId, text, `${id}:help`);
    db.stats.replied += 1;
    logActivity('bot_reply', `Panduan bot dikirim melalui ${platform}`);
    await persist();
    return { replied: true, type: 'help' };
  }
  if (command === '.cancel') {
    for (const [token, session] of Object.entries(db.sessions)) {
      if (session.platform === platform && session.senderId === message.senderId && session.conversationId === message.conversationId) delete db.sessions[token];
    }
    await sendText(message.conversationId, 'Sesi tool sebelumnya dibatalkan. Ketik .menu untuk mulai kembali.', `${id}:cancel`);
    db.stats.replied += 1;
    logActivity('bot_reply', `Sesi tool dibatalkan melalui ${platform}`);
    await persist();
    return { replied: true, type: 'cancel' };
  }
  if (command === '.info') {
    await sendText(message.conversationId, 'DAFZZ BOT\nKatalog: 401 entri\nKategori: 7\nKategori AI & Bot Commands: Chat AI + 50 AI/Local Tools + 50 Bot Commands\nEnam kategori lama: masing-masing 50 tools\nKetik .menu untuk melihat daftar.', `${id}:info`);
    db.stats.replied += 1;
    logActivity('bot_reply', `Informasi bot dikirim melalui ${platform}`);
    await persist();
    return { replied: true, type: 'info' };
  }

  const customCommand = await handleBotCommand(rawText);
  if (customCommand) {
    await sendText(message.conversationId, customCommand.reply, `${id}:custom:${customCommand.command}`);
    db.stats.replied += 1;
    if (customCommand.type === 'ai' && !isFallbackAIResponse(customCommand.reply)) db.stats.aiReplies = (db.stats.aiReplies || 0) + 1;
    logActivity(customCommand.type === 'ai' ? (isFallbackAIResponse(customCommand.reply) ? 'ai_error' : 'ai_reply') : 'bot_reply', `Perintah ${customCommand.command} diproses melalui ${platform}`);
    await persist();
    return { replied: true, type: 'bot-command', command: customCommand.command };
  }

  const category = CATEGORIES.find(([slug]) => command === `.${slug}`);
  if (category) {
    await sendText(message.conversationId, categoryText(category[0]), `${id}:category:${category[0]}`);
    db.stats.replied += 1;
    logActivity('bot_reply', `Daftar kategori ${category[0]} dikirim melalui ${platform}`);
    await persist();
    return { replied: true, type: 'category' };
  }

  const tool = findTool(rawText);
  if (tool) {
    await startToolSession({ ...message, platform }, tool, id, sendText);
    db.stats.replied += 1;
    logActivity('tool_link', `Tautan sesi tool ${tool.slug} dibuat melalui ${platform}`);
    await persist();
    return { replied: true, type: 'tool', slug: tool.slug };
  }

  const answer = await askFreeAI(rawText, { requesterIp: platform });
  await sendText(message.conversationId, answer, `${id}:ai-fallback`);
  db.stats.replied += 1;
  if (isFallbackAIResponse(answer)) {
    logActivity('ai_error', `Pesan fallback dikirim karena AI tidak tersedia melalui ${platform}`);
  } else {
    db.stats.aiReplies = (db.stats.aiReplies || 0) + 1;
    logActivity('ai_reply', `AI fallback memberikan balasan melalui ${platform}`);
  }
  await persist();
  return { replied: true, type: 'ai-fallback' };
}

export async function handleExternalMessage(message, sendText) {
  if (!message || typeof sendText !== 'function') throw new TypeError('Pesan dan fungsi pengiriman wajib tersedia.');
  const normalized = {
    platform: message.platform,
    conversationId: String(message.conversationId || ''),
    senderId: String(message.senderId || ''),
    messageId: String(message.messageId || ''),
    messageType: String(message.messageType || ''),
    text: String(message.text || '')
  };
  const db = getDb();
  const messageId = normalized.messageId;
  if (messageId && db.processedEvents[messageId]?.status === 'done') return { ignored: 'duplicate_message' };
  try {
    const result = await processIncomingMessage(normalized, sendText);
    if (messageId) {
      db.processedEvents[messageId] = { status: 'done', createdAt: Date.now(), platform: normalized.platform };
      const entries = Object.entries(db.processedEvents);
      if (entries.length > 4000) {
        entries.sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
        for (const [key] of entries.slice(0, entries.length - 3500)) delete db.processedEvents[key];
      }
      await persist();
    }
    return result;
  } catch (error) {
    if (messageId) delete db.processedEvents[messageId];
    throw error;
  }
}

export async function handleTikTokEvent(event, requestOrigin = '') {
  const msg = normalizedMessage(event);
  if (!msg.conversationId) return { ignored: 'conversation_id_missing' };
  if (msg.eventName && !msg.eventName.includes('message.received')) return { ignored: 'not_incoming_message' };
  const id = msg.eventId || crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
  const result = await processIncomingMessage({
    platform: 'tiktok',
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    messageId: id,
    messageType: msg.messageType,
    text: msg.text
  }, sendTikTokText);
  return result;
}

export function getCatalogStats() {
  return {
    total: tools.length,
    categories: CATEGORIES.map(([slug, name]) => ({ slug, name, count: tools.filter(tool => tool.category === slug).length }))
  };
}

export function findCatalogTool(slug) { return tools.find(tool => tool.slug === slug) || null; }
