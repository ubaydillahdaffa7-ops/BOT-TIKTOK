import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { verifyTikTokBridgeSignature, safeFileName, isValidHttpUrl } from './security.js';
import { getCatalogStats, findCatalogTool, handleExternalMessage } from './bot.js';
import { BOT_COMMANDS, AI_LOCAL_BOT_COMMANDS, AI_TOOL_COMMANDS, LOCAL_AI_TOOL_COMMANDS, handleBotCommand } from './bot-commands.js';
import { askFreeAI, resolveAIConfiguration } from './ai.js';
import { getDb, initStore, persist } from './store.js';

await initStore();

const catalog = JSON.parse(fs.readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));

test('catalog preserves 300 original tools and adds category seven with 101 entries', () => {
  assert.equal(catalog.length, 401);
  assert.equal(new Set(catalog.map(tool => tool.slug)).size, 401);
  const original = catalog.slice(0, 300);
  const expected = ['foto', 'teks', 'file', 'konverter', 'keamanan', 'web'];
  assert.deepEqual([...new Set(original.map(tool => tool.category))].sort(), [...expected].sort());
  for (const category of expected) {
    assert.equal(original.filter(tool => tool.category === category).length, 50, `${category} must retain 50 tools`);
  }
  const added = catalog.slice(300);
  assert.equal(added.length, 101);
  assert.equal(added.filter(tool => tool.group === 'featured').length, 1);
  assert.equal(added.filter(tool => tool.group === 'ai-local').length, 50);
  assert.equal(added.filter(tool => tool.group === 'ai-local' && tool.engine === 'ai').length, 25);
  assert.equal(added.filter(tool => tool.group === 'ai-local' && tool.engine === 'local').length, 25);
  assert.equal(added.filter(tool => tool.group === 'bot-command').length, 50);
  assert.ok(added.find(tool => tool.slug === 'chat-ai' && tool.command === '.ai'));
  for (const tool of added.filter(tool => tool.group === 'ai-local')) assert.equal(tool.command, `.${tool.slug}`);
  assert.deepEqual([...AI_LOCAL_BOT_COMMANDS].sort(), added.filter(tool => tool.group === 'ai-local').map(tool => tool.slug).sort());
  assert.equal(AI_TOOL_COMMANDS.length, 25);
  assert.equal(LOCAL_AI_TOOL_COMMANDS.length, 25);
  const script = fs.readFileSync(new URL('./script.js', import.meta.url), 'utf8');
  const aiPromptBlock = script.match(/const AI_TOOL_PROMPTS=\{([\s\S]*?)\n\};/)?.[1] || '';
  const aiPromptSlugs = [...aiPromptBlock.matchAll(/^'([^']+)':/gm)].map(match => match[1]);
  const localHandlerBlock = script.match(/function runLocalAiTool[\s\S]*?\n\}/)?.[0] || '';
  const localHandlerSlugs = [...localHandlerBlock.matchAll(/case '([^']+)':/g)].map(match => match[1]);
  assert.deepEqual(added.filter(tool => tool.group === 'ai-local' && tool.engine === 'ai').map(tool => tool.slug).sort(), aiPromptSlugs.sort());
  assert.deepEqual(added.filter(tool => tool.group === 'ai-local' && tool.engine === 'local').map(tool => tool.slug).sort(), localHandlerSlugs.sort());
  assert.ok(added.every(tool => tool.category === 'ai-bot'));
  const stats = getCatalogStats();
  assert.equal(stats.total, 401);
  assert.equal(stats.categories.length, 7);
  assert.equal(stats.categories[0].slug, 'ai-bot');
});

test('every catalog entry has a slug, name, description and valid category', () => {
  const categories = new Set(['ai-bot', 'foto', 'teks', 'file', 'konverter', 'keamanan', 'web']);
  for (const tool of catalog) {
    assert.match(tool.slug, /^[a-z0-9-]+$/);
    assert.ok(tool.name?.trim());
    assert.ok(tool.description?.trim());
    assert.ok(categories.has(tool.category));
  }
});

test('tool lookup resolves known source tools', () => {
  assert.equal(findCatalogTool('potong-gambar')?.name, catalog.find(x => x.slug === 'potong-gambar').name);
  assert.ok(findCatalogTool('word-to-pdf'));
  assert.equal(findCatalogTool('not-a-real-tool'), null);
});


test('50 Bot Commands are unique and new commands work without duplicating old utility tools', async () => {
  assert.equal(BOT_COMMANDS.length, 50);
  assert.equal(AI_LOCAL_BOT_COMMANDS.length, 50);
  assert.equal(new Set(AI_LOCAL_BOT_COMMANDS).size, 50);
  assert.equal(new Set(BOT_COMMANDS.map(item => item.name)).size, 50);
  const oldTools = new Set(catalog.slice(0, 300).map(item => item.slug));
  for (const item of BOT_COMMANDS) assert.ok(!oldTools.has(item.name), `.${item.name} must not duplicate an old tool slug`);
  for (const duplicate of ['calc', 'password', 'uuid', 'morse', 'qrcode', 'reverse', 'base64', 'hash']) {
    assert.ok(!BOT_COMMANDS.some(item => item.name === duplicate), `.${duplicate} is already covered by the original tool catalog`);
  }
  const choose = await handleBotCommand('.choose merah | biru | hijau');
  assert.equal(choose.command, 'choose');
  assert.match(choose.reply, /Pilihan terpilih:/);
  const previousFetch = globalThis.fetch;
  let pinUrl = '';
  globalThis.fetch = async url => {
    pinUrl = String(url);
    return new Response(JSON.stringify({ query: { pages: { '42': { title: 'File:Naruto test.png', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/example.png' }] } } } }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  let pin;
  try { pin = await handleBotCommand('.pin Naruto #77'); }
  finally { globalThis.fetch = previousFetch; }
  assert.match(pinUrl, /gsrlimit=10/);
  assert.match(pin.reply, /maksimal 10/);
  assert.match(pin.reply, /upload.wikimedia.org\/example.png/);
  const sticker = await handleBotCommand('.s');
  assert.match(sticker.reply, /memproses teks/);
  assert.equal(await handleBotCommand('.calc 2+2'), null);
  const count = await handleBotCommand('.sentence-counter Satu. Dua!');
  assert.match(count.reply, /Jumlah kalimat: 2/);
  const hashtags = await handleBotCommand('.extract-hashtags #dafzz #tools #dafzz');
  assert.equal(hashtags.reply, '#dafzz\n#tools');
  const ts = await handleBotCommand('.json-to-typescript {"name":"DAFZZ","active":true}');
  assert.match(ts.reply, /name: string;/);
  assert.match(ts.reply, /active: boolean;/);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Cerita uji DAFZZ.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const aiStory = await handleBotCommand('.ai-story seekor kucing menemukan bintang');
    assert.equal(aiStory.type, 'ai');
    assert.equal(aiStory.reply, 'Cerita uji DAFZZ.');
  } finally { globalThis.fetch = oldFetch; }
});

test('25 Local Tools kategori tujuh memiliki handler DM yang dapat dijalankan', async () => {
  const examples = {
    'sentence-counter': 'Satu. Dua!', 'paragraph-counter': 'Satu\n\nDua', 'reading-time': 'satu dua tiga',
    'character-frequency': 'aab', 'remove-diacritics': 'café', 'unicode-normalizer': 'teks',
    'smart-quotes': '\"halo\"', 'strip-control-chars': '\u0007aman', 'extract-hashtags': '#dafzz #tools',
    'extract-mentions': '@dafzz @tools', 'extract-phone': '+6281234567890', 'extract-numbers': 'umur 14 tahun',
    'extract-dates': '26/11/2026', 'initials-generator': 'DAFZZ BOT', 'text-wrap': '--20 ini contoh teks untuk dibungkus',
    'text-prefixer': 'baris satu\nbaris dua', 'text-suffixer': 'baris satu\nbaris dua',
    'list-numberer': 'satu\ndua', 'list-bulletizer': 'satu\ndua', 'random-choice': 'merah|biru',
    'text-repeater': '--2\nHalo', 'template-filler': 'Halo {{nama}}\n---\nnama=DAFZZ',
    'csv-to-markdown-table': 'nama,umur\nAni,14', 'json-to-typescript': '{\"nama\":\"DAFZZ\"}',
    'line-numberer': 'satu\ndua'
  };
  assert.deepEqual(Object.keys(examples).sort(), [...LOCAL_AI_TOOL_COMMANDS].sort());
  for (const [slug, input] of Object.entries(examples)) {
    const result = await handleBotCommand(`.${slug} ${input}`);
    assert.ok(result && result.type === 'local-tool' && result.reply.length > 0, `.${slug} must execute`);
    assert.doesNotMatch(result.reply, /belum memiliki handler/i);
  }
});


test('Telegram and WhatsApp share the same 401-tool menu and platform-aware session dispatcher', async () => {
  const settings = getDb().settings;
  const previous = {
    telegram: { ...settings.platforms.telegram },
    whatsapp: { ...settings.platforms.whatsapp }
  };
  const originalStats = JSON.parse(JSON.stringify(getDb().stats));
  const replies = [];
  const sender = async (chatId, text, key) => replies.push({ chatId, text, key });
  settings.platforms.telegram.enabled = true;
  settings.platforms.whatsapp.enabled = true;
  try {
    const telegram = await handleExternalMessage({
      platform: 'telegram', conversationId: 'tg-chat-1', senderId: 'tg-user-1',
      messageId: 'qa:telegram:menu', text: '.menu'
    }, sender);
    const whatsapp = await handleExternalMessage({
      platform: 'whatsapp', conversationId: '6281234567890@s.whatsapp.net', senderId: '6281234567890@s.whatsapp.net',
      messageId: 'qa:whatsapp:menu', text: '.menu'
    }, sender);
    assert.equal(telegram.type, 'menu');
    assert.equal(whatsapp.type, 'menu');
    assert.equal(replies.length, 2);
    assert.match(replies[0].text, /401 ENTRI - 7 KATEGORI/);
    assert.match(replies[1].text, /401 ENTRI - 7 KATEGORI/);
    assert.equal(replies[0].chatId, 'tg-chat-1');
    assert.equal(replies[1].chatId, '6281234567890@s.whatsapp.net');
    const duplicate = await handleExternalMessage({
      platform: 'telegram', conversationId: 'tg-chat-1', senderId: 'tg-user-1',
      messageId: 'qa:telegram:menu', text: '.menu'
    }, sender);
    assert.equal(duplicate.ignored, 'duplicate_message');
    assert.equal(replies.length, 2);
  } finally {
    settings.platforms.telegram = previous.telegram;
    settings.platforms.whatsapp = previous.whatsapp;
    getDb().stats = originalStats;
    delete getDb().processedEvents['qa:telegram:menu'];
    delete getDb().processedEvents['qa:whatsapp:menu'];
    await persist();
  }
});


test('the .ai command is routed through the shared dispatcher for Telegram and WhatsApp', async () => {
  const settings = getDb().settings;
  const previous = {
    telegram: { ...settings.platforms.telegram },
    whatsapp: { ...settings.platforms.whatsapp },
    aiEnabled: settings.aiEnabled,
    aiMode: settings.aiMode,
    fallbackPrefix: settings.fallbackPrefix
  };
  const previousFetch = globalThis.fetch;
  const replies = [];
  settings.platforms.telegram.enabled = true;
  settings.platforms.whatsapp.enabled = true;
  settings.aiEnabled = true;
  settings.aiMode = 'pollinations';
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://text.pollinations.ai/openai');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Jawaban AI DAFZZ untuk chat ini.' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const sender = async (chatId, text, key) => replies.push({ chatId, text, key });
    const telegram = await handleExternalMessage({
      platform: 'telegram', conversationId: 'tg-chat-ai', senderId: 'tg-user-ai',
      messageId: 'qa:telegram:ai', text: '.ai halo'
    }, sender);
    const whatsapp = await handleExternalMessage({
      platform: 'whatsapp', conversationId: '628000000000@s.whatsapp.net', senderId: '628000000000@s.whatsapp.net',
      messageId: 'qa:whatsapp:ai', text: '.ai halo'
    }, sender);
    assert.equal(telegram.type, 'bot-command');
    assert.equal(whatsapp.type, 'bot-command');
    assert.equal(replies.length, 2);
    assert.ok(replies.every(item => item.text === 'Jawaban AI DAFZZ untuk chat ini.'));
  } finally {
    globalThis.fetch = previousFetch;
    settings.platforms.telegram = previous.telegram;
    settings.platforms.whatsapp = previous.whatsapp;
    settings.aiEnabled = previous.aiEnabled;
    settings.aiMode = previous.aiMode;
    settings.fallbackPrefix = previous.fallbackPrefix;
    delete getDb().processedEvents['qa:telegram:ai'];
    delete getDb().processedEvents['qa:whatsapp:ai'];
    await persist();
  }
});


test('the configuration UI has three bot menus, five separate Paham acknowledgements, and the requested admin details', () => {
  const admin = fs.readFileSync(new URL('./admin.html', import.meta.url), 'utf8');
  const home = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const bot = fs.readFileSync(new URL('./bot.html', import.meta.url), 'utf8');
  const adminJs = fs.readFileSync(new URL('./admin.js', import.meta.url), 'utf8');
  assert.equal((admin.match(/<button class="platform-choice/g) || []).length, 3);
  assert.equal((admin.match(/class="risk-item"/g) || []).length, 5);
  assert.equal((admin.match(/class="risk-ack"/g) || []).length, 5);
  assert.match(adminJs, /riskAcknowledgements\.size !== 5/);
  assert.match(adminJs, /confirmRiskBtn'\)\.disabled = count !== 5/);
  for (const page of [home, bot, admin]) {
    assert.match(page, /id="adminInfoDialog"/);
    assert.match(page, /ubaydillahdaffa7@gmail\.com/);
    assert.match(page, /portofolio-dafzz-stlr\.onrender\.com/);
    assert.match(page, /belajar-si-qjko\.onrender\.com/);
    assert.match(page, /root_403_access/);
  }
});

test('share preview metadata points to the included 1200x630 PNG image', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const image = fs.readFileSync(new URL('./og-preview.png', import.meta.url));
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:image"/);
  assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});

test('webhook HMAC accepts valid signature and rejects stale or altered bodies', () => {
  const secret = 'test-secret-not-used-in-production';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = Buffer.from('{"id":"event-1","type":"message.received"}');
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  const headers = { 'x-ttdm-signature': `t=${timestamp},v1=${signature}`, 'x-ttdm-event-id': 'event-1' };
  assert.equal(verifyTikTokBridgeSignature(body, headers, secret), true);
  assert.equal(verifyTikTokBridgeSignature(Buffer.from('altered'), headers, secret), false);
  const old = timestamp - 600;
  const oldSignature = crypto.createHmac('sha256', secret).update(`${old}.`).update(body).digest('hex');
  assert.equal(verifyTikTokBridgeSignature(body, { ...headers, 'x-ttdm-signature': `t=${old},v1=${oldSignature}` }, secret), false);
  assert.equal(verifyTikTokBridgeSignature(body, headers, ''), false);
});

test('download filenames are reduced to safe basename characters', () => {
  assert.equal(safeFileName('../../laporan rahasia.pdf'), 'laporan-rahasia.pdf');
  assert.equal(safeFileName(''), 'hasil.bin');
  assert.ok(!safeFileName('..').includes('..'));
});

test('admin URL validator accepts only HTTP and HTTPS URLs', () => {
  assert.equal(isValidHttpUrl('https://example.com'), true);
  assert.equal(isValidHttpUrl('http://127.0.0.1:3000'), true);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl('not a url'), false);
});


test('Pollinations automatic AI uses the tested endpoint and alias without a key', () => {
  const config = resolveAIConfiguration({ aiMode: 'pollinations', aiEndpoint: 'https://wrong.example', aiModel: 'wrong', aiApiKey: 'must-not-be-used' });
  assert.equal(config.mode, 'pollinations');
  assert.equal(config.endpoint, 'https://text.pollinations.ai/openai');
  assert.equal(config.model, 'openai');
  assert.equal(config.apiKey, '');
});

test('manual AI mode keeps the administrator endpoint, model, and key', () => {
  const config = resolveAIConfiguration({ aiMode: 'custom', aiEndpoint: 'https://api.example/v1/chat/completions', aiModel: 'example/chat-model', aiApiKey: 'secret-test-value' });
  assert.equal(config.mode, 'custom');
  assert.equal(config.endpoint, 'https://api.example/v1/chat/completions');
  assert.equal(config.model, 'example/chat-model');
  assert.equal(config.apiKey, 'secret-test-value');
});


test('Pollinations fallback sends a POST with the tested alias and no API key', async () => {
  const settings = getDb().settings;
  const previousSettings = { ...settings };
  const previousFetch = globalThis.fetch;
  let captured;
  Object.assign(settings, { aiEnabled: true, aiMode: 'pollinations', fallbackPrefix: 'DAFZZ:' });
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Koneksi AI aktif.' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const answer = await askFreeAI('Uji koneksi');
    assert.equal(captured.url, 'https://text.pollinations.ai/openai');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.Authorization, undefined);
    assert.equal(JSON.parse(captured.options.body).model, 'openai');
    assert.match(answer, /Koneksi AI aktif/);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(settings, previousSettings);
  }
});

test('manual AI fallback sends the API key only as a server-side bearer header', async () => {
  const settings = getDb().settings;
  const previousSettings = { ...settings };
  const previousFetch = globalThis.fetch;
  let captured;
  Object.assign(settings, {
    aiEnabled: true,
    aiMode: 'custom',
    aiEndpoint: 'https://api.example/v1/chat/completions',
    aiModel: 'example/chat-model',
    aiApiKey: 'secret-test-value',
    fallbackPrefix: 'DAFZZ:'
  });
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Jawaban manual aktif.' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const answer = await askFreeAI('Uji mode manual');
    assert.equal(captured.url, 'https://api.example/v1/chat/completions');
    assert.equal(captured.options.headers.Authorization, 'Bearer secret-test-value');
    assert.equal(JSON.parse(captured.options.body).model, 'example/chat-model');
    assert.match(answer, /Jawaban manual aktif/);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(settings, previousSettings);
  }
});

test('automatic AI tries three anonymous backup gateways after Pollinations fails', async () => {
  const settings = getDb().settings;
  const previousSettings = { ...settings };
  const previousFetch = globalThis.fetch;
  const attempted = [];
  const attemptedOptions = [];
  Object.assign(settings, { aiEnabled: true, aiMode: 'pollinations', fallbackPrefix: 'DAFZZ:' });
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    attempted.push(address);
    attemptedOptions.push(options);
    if (address === 'https://api.llm7.io/v1/models') {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-oss:20b', usage_based_only: false }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (address === 'https://oai.aihorde.net/v1/models') {
      return new Response(JSON.stringify({ data: [{ id: 'horde/test-instruct-model' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (address.endsWith('/v1/chat/completions')) {
      if (address.includes('oai.aihorde.net')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Jawaban dari AI Horde anonim.' } }] }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('temporary unavailable', { status: 503 });
    }
    return new Response('temporary unavailable', { status: 503 });
  };
  try {
    const answer = await askFreeAI('Uji failover AI');
    assert.equal(attempted[0], 'https://text.pollinations.ai/openai');
    assert.equal(attempted[1], 'https://ai-gateway.kilo.ai/api/v1/chat/completions');
    assert.equal(attempted[2], 'https://api.llm7.io/v1/models');
    assert.equal(attempted[3], 'https://api.llm7.io/v1/chat/completions');
    assert.equal(attempted[4], 'https://oai.aihorde.net/v1/models');
    assert.equal(attempted[5], 'https://oai.aihorde.net/v1/chat/completions');
    assert.equal(attemptedOptions[1].headers?.Authorization, undefined);
    assert.equal(attemptedOptions[3].headers?.Authorization, undefined);
    assert.equal(attemptedOptions[5].headers?.Authorization, 'Bearer 0000000000');
    assert.match(answer, /Jawaban dari AI Horde anonim/);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(settings, previousSettings);
  }
});
