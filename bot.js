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
    'Kategori AI & Bot Commands berisi Chat AI unggulan, 50 AI/Local Tools, dan 50 perintah TikTok.',
    'AI/Local Tools juga dapat dipanggil di DM: ketik .ai-story teks atau .sentence-counter teks.',
    'Ketik .commands untuk melihat 50 perintah tambahan.',
    'Pilih kategori atau langsung ketik perintah tool.',
    'Contoh: .potong-gambar',
    'Ketik .help untuk bantuan.'
  ].join('\n');
}

function categoryText(categorySlug) {
  const group = tools.filter(tool => tool.category === categorySlug);
  if (categorySlug === 'ai-bot') return ['AI & BOT COMMANDS - 101 ENTRI', '', 'CHAT AI - .ai untuk bertanya langsung di DM', '50 AI & LOCAL TOOLS - tersedia di website dan DM dengan format .slug teks', 'Contoh: .ai-story ide cerita atau .sentence-counter teks', '50 BOT COMMANDS - ketik .commands untuk daftar lengkap', '', 'Catatan: .pin menghasilkan tautan pencarian, bukan lampiran foto. .s dan .toimg menunggu dukungan media dari Bridge.'].join('\n');
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

function sessionLookupKey(message) {
  return `${message.senderId || 'sender'}:${message.conversationId}`;
}

function createRunUrl(token, slug) {
  const base = publicBase();
  if (!base) return '';
  return `${base}/run/${token}?tool=${encodeURIComponent(slug)}`;
}

async function startToolSession(message, tool, eventId, requestOrigin = '') {
  const db = getDb();
  const token = randomToken(24);
  const runUrl = createRunUrl(token, tool.slug);
  if (!runUrl) {
    await sendTikTokText(message.conversationId,
      `Tool ${tool.name} siap digunakan, tetapi alamat website belum diatur. Masuk ke Admin DAFZZ dan isi URL publik HTTPS terlebih dahulu.`,
      `${eventId}:missing-url`);
    return;
  }
  db.sessions[token] = {
    token,
    platform: 'tiktok',
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
    'Setelah proses selesai, hasil unduhan akan dikirim kembali ke chat ini.',
    'Tautan sesi berlaku 24 jam.'
  ].join('\n');
  await sendTikTokText(message.conversationId, reply, `${eventId}:tool-link`);
}

export async function handleTikTokEvent(event, requestOrigin = '') {
  const msg = normalizedMessage(event);
  if (!msg.conversationId) return { ignored: 'conversation_id_missing' };
  if (msg.eventName && !msg.eventName.includes('message.received')) return { ignored: 'not_incoming_message' };

  const db = getDb();
  if (db.settings.botEnabled === false) {
    db.processedEvents[msg.eventId || crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex')] = { status: 'done', createdAt: Date.now(), ignored: 'bot-disabled' };
    await persist();
    return { ignored: 'bot_disabled' };
  }
  db.stats.received += 1;
  logActivity('message_received', 'Pesan DM TikTok baru diterima');
  const id = msg.eventId || crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
  const sessionKey = sessionLookupKey(msg);
  const rawText = msg.text.trim();

  if (!rawText) {
    if (msg.messageType === '8' || msg.messageType.toLowerCase().includes('media')) {
      await sendTikTokText(msg.conversationId,
        'File dari DM TikTok belum dapat dibaca oleh konektor ini. Ketik perintah tool terlebih dahulu, lalu unggah file melalui halaman DAFZZ yang dikirim bot.',
        `${id}:media-notice`);
      db.stats.replied += 1;
      logActivity('bot_reply', 'Pemberitahuan jenis file DM dikirim');
    }
    await persist();
    return { ignored: 'empty_or_media' };
  }

  const command = rawText.toLowerCase();
  if (command === '.menu' || command === '.start') {
    await sendTikTokText(msg.conversationId, menuText(), `${id}:menu`);
    db.stats.replied += 1;
    logActivity('bot_reply', 'Menu utama dikirim ke DM');
    await persist();
    return { replied: true, type: 'menu' };
  }
  if (command === '.help') {
    const text = [
      'PANDUAN DAFZZ BOT',
      '.menu - tampilkan tujuh kategori',
      '.ai-bot - ringkasan kategori AI & Bot Commands',
      '.commands - tampilkan 50 perintah bot baru',
      '.foto / .teks / .file / .konverter / .keamanan / .web - tampilkan daftar tools',
      '.cancel - batalkan sesi sebelumnya',
      '.info - informasi bot',
      '',
      'Gunakan nama perintah dengan titik di depan. Contoh: .word-to-pdf.'
    ].join('\n');
    await sendTikTokText(msg.conversationId, text, `${id}:help`);
    db.stats.replied += 1;
    logActivity('bot_reply', 'Panduan bot dikirim ke DM');
    await persist();
    return { replied: true, type: 'help' };
  }
  if (command === '.cancel') {
    for (const [token, session] of Object.entries(db.sessions)) {
      if (session.senderId === msg.senderId && session.conversationId === msg.conversationId) delete db.sessions[token];
    }
    await sendTikTokText(msg.conversationId, 'Sesi tool sebelumnya dibatalkan. Ketik .menu untuk mulai kembali.', `${id}:cancel`);
    db.stats.replied += 1;
    logActivity('bot_reply', 'Sesi tool dibatalkan');
    await persist();
    return { replied: true, type: 'cancel' };
  }
  if (command === '.info') {
    await sendTikTokText(msg.conversationId, 'DAFZZ BOT\nKatalog: 401 entri\nKategori: 7\nKategori AI & Bot Commands: Chat AI + 50 AI/Local Tools + 50 Bot Commands\nEnam kategori lama: masing-masing 50 tools\nKetik .menu untuk melihat daftar.', `${id}:info`);
    db.stats.replied += 1;
    logActivity('bot_reply', 'Informasi bot dikirim ke DM');
    await persist();
    return { replied: true, type: 'info' };
  }

  const customCommand = await handleBotCommand(rawText);
  if (customCommand) {
    await sendTikTokText(msg.conversationId, customCommand.reply, `${id}:custom:${customCommand.command}`);
    db.stats.replied += 1;
    if (customCommand.type === 'ai' && !isFallbackAIResponse(customCommand.reply)) db.stats.aiReplies = (db.stats.aiReplies || 0) + 1;
    logActivity(customCommand.type === 'ai' ? (isFallbackAIResponse(customCommand.reply) ? 'ai_error' : 'ai_reply') : 'bot_reply', `Perintah ${customCommand.command} diproses`);
    await persist();
    return { replied: true, type: 'bot-command', command: customCommand.command };
  }

  const category = CATEGORIES.find(([slug]) => command === `.${slug}`);
  if (category) {
    await sendTikTokText(msg.conversationId, categoryText(category[0]), `${id}:category:${category[0]}`);
    db.stats.replied += 1;
    logActivity('bot_reply', `Daftar kategori ${category[0]} dikirim ke DM`);
    await persist();
    return { replied: true, type: 'category' };
  }

  const tool = findTool(rawText);
  if (tool) {
    await startToolSession(msg, tool, id, requestOrigin);
    db.stats.replied += 1;
    logActivity('tool_link', `Tautan sesi tool ${tool.slug} dibuat`);
    await persist();
    return { replied: true, type: 'tool', slug: tool.slug };
  }

  const answer = await askFreeAI(rawText, { requesterIp: 'tiktok-bridge' });
  await sendTikTokText(msg.conversationId, answer, `${id}:ai-fallback`);
  db.stats.replied += 1;
  if (isFallbackAIResponse(answer)) {
    logActivity('ai_error', 'Pesan fallback dikirim karena AI tidak tersedia');
  } else {
    db.stats.aiReplies = (db.stats.aiReplies || 0) + 1;
    logActivity('ai_reply', 'AI fallback memberikan balasan ke DM');
  }
  await persist();
  return { replied: true, type: 'ai-fallback' };
}

export function getCatalogStats() {
  return {
    total: tools.length,
    categories: CATEGORIES.map(([slug, name]) => ({ slug, name, count: tools.filter(tool => tool.category === slug).length }))
  };
}

export function findCatalogTool(slug) { return tools.find(tool => tool.slug === slug) || null; }
