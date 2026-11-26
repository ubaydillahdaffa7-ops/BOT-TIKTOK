import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { verifyTikTokBridgeSignature, safeFileName, isValidHttpUrl } from './security.js';
import { getCatalogStats, findCatalogTool } from './bot.js';
import { BOT_COMMANDS, AI_LOCAL_BOT_COMMANDS, AI_TOOL_COMMANDS, LOCAL_AI_TOOL_COMMANDS, handleBotCommand } from './bot-commands.js';
import { askFreeAI, resolveAIConfiguration } from './ai.js';
import { getDb } from './store.js';

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
  assert.match(sticker.reply, /hanya mendukung pesan teks/);
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

test('automatic AI tries three keyless backup gateways after the primary fails', async () => {
  const settings = getDb().settings;
  const previousSettings = { ...settings };
  const previousFetch = globalThis.fetch;
  const attempted = [];
  Object.assign(settings, { aiEnabled: true, aiMode: 'pollinations', fallbackPrefix: 'DAFZZ:' });
  globalThis.fetch = async (url) => {
    attempted.push(String(url));
    if (attempted.length < 4) return new Response('temporary unavailable', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Jawaban dari AI cadangan ketiga.' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const answer = await askFreeAI('Uji failover AI');
    assert.equal(attempted.length, 4);
    assert.equal(attempted[0], 'https://text.pollinations.ai/openai');
    assert.equal(attempted[1], 'https://api.jarvisclaw.ai/v1/chat/completions');
    assert.equal(attempted[2], 'https://api.free.ai/v1/chat/completions');
    assert.equal(attempted[3], 'https://api.kilo.ai/api/gateway/chat/completions');
    assert.match(answer, /Jawaban dari AI cadangan ketiga/);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(settings, previousSettings);
  }
});
