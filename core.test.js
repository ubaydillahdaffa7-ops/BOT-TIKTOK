import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { verifyTikTokBridgeSignature, safeFileName, isValidHttpUrl } from './security.js';
import { getCatalogStats, findCatalogTool } from './bot.js';
import { askFreeAI, resolveAIConfiguration } from './ai.js';
import { getDb } from './store.js';

const catalog = JSON.parse(fs.readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));

test('catalog contains exactly 300 tools and six categories of 50', () => {
  assert.equal(catalog.length, 300);
  assert.equal(new Set(catalog.map(tool => tool.slug)).size, 300);
  const expected = ['foto', 'teks', 'file', 'konverter', 'keamanan', 'web'];
  assert.deepEqual([...new Set(catalog.map(tool => tool.category))].sort(), [...expected].sort());
  for (const category of expected) {
    assert.equal(catalog.filter(tool => tool.category === category).length, 50, `${category} must have 50 tools`);
  }
  const stats = getCatalogStats();
  assert.equal(stats.total, 300);
  assert.equal(stats.categories.length, 6);
});

test('every catalog entry has a slug, name, description and valid category', () => {
  const categories = new Set(['foto', 'teks', 'file', 'konverter', 'keamanan', 'web']);
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
