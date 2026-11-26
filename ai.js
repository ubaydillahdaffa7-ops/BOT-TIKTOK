import { getDb, logActivity, persist } from './store.js';

// Primary provider: the exact legacy Pollinations endpoint already used by the user's working site.
const POLLINATIONS_ENDPOINT = 'https://text.pollinations.ai/openai';
const POLLINATIONS_MODEL = 'openai';

// Three keyless fallback gateways. These are best-effort community services;
// their free quotas, availability, and terms can change without notice.
const FREE_FALLBACKS = [
  { name: 'JarvisClaw Free', endpoint: 'https://api.jarvisclaw.ai/v1/chat/completions', model: 'auto/free' },
  { name: 'Free.ai', endpoint: 'https://api.free.ai/v1/chat/completions', model: 'deepseek-r1' },
  { name: 'Kilo Gateway Free', endpoint: 'https://api.kilo.ai/api/gateway/chat/completions', model: 'kilo-auto/free' }
];
const PROVIDER_TIMEOUT_MS = 12000;
const SYSTEM_PROMPT = [
  'Kamu adalah DAFZZ BOT, asisten percakapan yang ramah dan membantu pengguna Indonesia.',
  'Jawab dalam bahasa Indonesia yang natural, jelas, relevan, dan tidak bertele-tele.',
  'Jangan gunakan emoji. Jangan mengaku bisa menjalankan fitur yang belum tersedia.',
  'DAFZZ memiliki 401 entri dalam tujuh kategori: AI & Bot Commands, Foto & Desain, Teks & Data, Dokumen & File, Konverter & Kalkulator, Keamanan & Privasi, Web & Developer.',
  'Kategori AI & Bot Commands berisi Chat AI, 50 alat AI/lokal, dan 50 perintah bot TikTok. Jangan mengaku bisa mengirim foto atau stiker lewat TikTok Bridge bawaan karena konektor yang dipasang hanya mendukung pesan teks.',
  'Jika pengguna ingin memakai tool DAFZZ, arahkan untuk mengetik .menu atau nama perintah tool.',
  'Jika pesan tidak jelas, minta penjelasan singkat. Jangan meminta password, cookie, token, atau data rahasia.'
].join(' ');

export function resolveAIConfiguration(settings = {}) {
  const mode = settings.aiMode === 'custom' ? 'custom' : 'pollinations';
  if (mode === 'pollinations') {
    return { mode, endpoint: POLLINATIONS_ENDPOINT, model: POLLINATIONS_MODEL, apiKey: '' };
  }
  return {
    mode,
    endpoint: settings.aiEndpoint || '',
    model: settings.aiModel || '',
    apiKey: settings.aiApiKey || ''
  };
}

function getFallback(prefix, detail = 'AI sedang tidak tersedia. Coba lagi nanti atau ketik .menu.') {
  return `${prefix}\n${detail}`;
}

export function isFallbackAIResponse(answer) {
  const failureHints = ['AI tidak dapat menjawab saat ini.', 'Layanan AI terlalu lama merespons.', 'Fitur AI sedang dinonaktifkan.', 'Konfigurasi AI belum lengkap.', 'AI sedang tidak tersedia.'];
  return failureHints.some(hint => String(answer || '').includes(hint));
}

async function requestProvider(provider, userText) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: String(userText).slice(0, 4000) }
        ],
        temperature: 0.6,
        max_tokens: 420,
        stream: false
      })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 120)}` : ''}`);
    }
    const contentType = response.headers.get('content-type') || '';
    let answer = '';
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? payload?.text ?? '';
      answer = Array.isArray(content)
        ? content.map(part => typeof part === 'string' ? part : part?.text || '').join('\n')
        : String(content || '');
    } else {
      answer = await response.text();
    }
    answer = answer.trim();
    if (!answer) throw new Error('Provider mengirim jawaban kosong');
    return answer.slice(0, 3400);
  } finally {
    clearTimeout(timeout);
  }
}

function getProviderChain(settings) {
  const config = resolveAIConfiguration(settings);
  const primary = config.mode === 'custom'
    ? { name: 'AI Manual', endpoint: config.endpoint, model: config.model, apiKey: config.apiKey }
    : { name: 'Pollinations AI', endpoint: POLLINATIONS_ENDPOINT, model: POLLINATIONS_MODEL };
  return [primary, ...FREE_FALLBACKS];
}

export async function askFreeAI(userText, context = {}) {
  const settings = getDb().settings;
  const prefix = settings.fallbackPrefix || 'Maaf kamu ngetik apa mpruy';
  const format = detail => context.includePrefix === false ? detail : getFallback(prefix, detail);
  if (!settings.aiEnabled) return format('Fitur AI sedang dinonaktifkan. Ketik .menu untuk melihat perintah yang tersedia.');

  const providers = getProviderChain(settings);
  const failures = [];
  for (const provider of providers) {
    if (!provider.endpoint || !provider.model) {
      failures.push(`${provider.name}: konfigurasi tidak lengkap`);
      continue;
    }
    try {
      const answer = await requestProvider(provider, userText);
      logActivity('ai_provider', `Jawaban AI melalui ${provider.name}`);
      return context.includePrefix === false ? answer : `${prefix}\n${answer}`;
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'timeout' : (error?.message || 'gagal');
      failures.push(`${provider.name}: ${reason}`);
      console.warn(`[ai-fallback] ${provider.name}: ${reason}`);
    }
  }

  logActivity('ai_error', 'Semua penyedia AI utama dan cadangan gagal');
  await persist().catch(() => {});
  const timedOut = failures.some(item => item.includes('timeout'));
  return format(timedOut
    ? 'Semua layanan AI terlalu lama merespons atau sedang sibuk. Coba lagi nanti atau ketik .menu.'
    : 'Semua layanan AI sedang tidak tersedia. Coba lagi nanti atau ketik .menu.');
}

export async function testFreeAI() {
  const answer = await askFreeAI('Balas tepat: Koneksi AI DAFZZ aktif.', { requesterIp: 'admin-test' });
  const ok = Boolean(answer) && !isFallbackAIResponse(answer);
  return { ok, answer, configuration: resolveAIConfiguration(getDb().settings), fallbackCount: FREE_FALLBACKS.length };
}
