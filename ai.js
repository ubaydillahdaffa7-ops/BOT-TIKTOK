import { getDb, logActivity, persist } from './store.js';

// Current Pollinations API: text generation requires a server-side secret key.
// Anonymous backup providers are best-effort and may change their limits or availability.
const POLLINATIONS_ENDPOINT = 'https://gen.pollinations.ai/v1/chat/completions';
const POLLINATIONS_MODEL = 'openai/gpt-5.4-nano';
const FREE_FALLBACKS = [
  {
    name: 'Kilo AI Gateway (model gratis)',
    endpoint: 'https://ai-gateway.kilo.ai/api/v1/chat/completions',
    model: 'kilo-auto/free',
    timeout: 15000
  },
  {
    name: 'LLM7 (akses anonim)',
    endpoint: 'https://api.llm7.io/v1/chat/completions',
    model: 'dynamic-llm7-model',
    timeout: 14000
  },
  {
    name: 'AI Horde (anonim)',
    endpoint: 'https://oai.aihorde.net/v1/chat/completions',
    model: 'dynamic-horde-model',
    apiKey: '0000000000',
    timeout: 22000
  }
];
const SYSTEM_PROMPT = [
  'Kamu adalah DAFZZ BOT, asisten percakapan yang ramah dan membantu pengguna Indonesia.',
  'Jawab dalam bahasa Indonesia yang natural, jelas, relevan, dan tidak bertele-tele.',
  'Jangan gunakan emoji. Jangan mengaku bisa menjalankan fitur yang belum tersedia.',
  'Utamakan ketepatan daripada terdengar yakin. Jangan mengarang nama, tanggal, angka, sumber, status koneksi, hasil pemeriksaan, atau kemampuan aplikasi.',
  'Jika informasi tidak tersedia di percakapan atau instruksi ini, katakan bahwa kamu belum dapat memastikannya dan jelaskan data apa yang diperlukan. Bedakan fakta, perkiraan, dan saran.',
  'Untuk informasi yang berubah-ubah seperti berita, harga, jadwal, kebijakan, atau versi layanan, jangan menyebutnya sebagai informasi terkini tanpa sumber atau pemeriksaan langsung.',
  'Jangan berpura-pura sudah membuka website, menjalankan tool, mengirim pesan, mengubah repository, atau menguji akun jika tindakan itu tidak benar-benar dilakukan.',
  'DAFZZ memiliki 401 entri dalam tujuh kategori: AI & Bot Commands, Foto & Desain, Teks & Data, Dokumen & File, Konverter & Kalkulator, Keamanan & Privasi, Web & Developer.',
  'Kategori AI & Bot Commands berisi Chat AI, 50 alat AI/lokal, dan 50 perintah bot. Koneksi chat saat ini memproses pesan teks.',
  'Jika pengguna ingin memakai tool DAFZZ, arahkan untuk mengetik .menu atau nama perintah tool.',
  'Jika pesan tidak jelas, minta penjelasan singkat. Jangan meminta password, cookie, token, kode OTP, atau data rahasia.'
].join(' ');

export function resolveAIConfiguration(settings = {}) {
  const mode = settings.aiMode === 'custom' ? 'custom' : 'pollinations';
  if (mode === 'pollinations') {
    const candidateKey = String(settings.pollinationsApiKey || process.env.POLLINATIONS_API_KEY || '').trim();
    return { mode, endpoint: POLLINATIONS_ENDPOINT, model: POLLINATIONS_MODEL, apiKey: candidateKey.startsWith('sk_') ? candidateKey : '' };
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
  const failureHints = ['AI tidak dapat menjawab saat ini.', 'Layanan AI terlalu lama merespons.', 'Fitur AI sedang dinonaktifkan.', 'Konfigurasi AI belum lengkap.', 'AI sedang tidak tersedia.', 'Semua layanan AI'];
  return failureHints.some(hint => String(answer || '').includes(hint));
}

async function getHordeModel() {
  const response = await fetch('https://oai.aihorde.net/v1/models', {
    headers: { Authorization: 'Bearer 0000000000' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`AI Horde models HTTP ${response.status}`);
  const payload = await response.json();
  const models = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  const available = models.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean);
  const preferred = available.find(name => /instruct|chat|llama|qwen|mistral/i.test(name)) || available[0];
  if (!preferred) throw new Error('AI Horde belum mengumumkan model teks yang tersedia');
  return preferred;
}

async function getLLM7Model() {
  const response = await fetch('https://api.llm7.io/v1/models', {
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`LLM7 models HTTP ${response.status}`);
  const payload = await response.json();
  const models = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  const rows = models.map(item => typeof item === 'string' ? { id: item } : item).filter(item => item?.id);
  const knownAnonymous = ['gpt-oss:20b', 'mistral-Nemo-Instruct-2407', 'codestral-latest', 'nemotron-3-nano:30b', 'minimax-m2.7'];
  const eligible = rows.filter(item => item.usage_based_only === false || knownAnonymous.includes(item.id));
  const preferred = eligible.find(item => knownAnonymous.includes(item.id)) || eligible[0];
  if (!preferred?.id) throw new Error('LLM7 tidak mengumumkan model anonim yang dikenal');
  return preferred.id;
}

async function requestProvider(provider, userText) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeout || 12000);
  try {
    const model = provider.model === 'dynamic-horde-model'
      ? await getHordeModel()
      : provider.model === 'dynamic-llm7-model' ? await getLLM7Model() : provider.model;
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: String(userText).slice(0, 4000) }
        ],
        temperature: 0.25,
        max_tokens: 420,
        stream: false
      })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 120)}` : ''}`);
    }
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { text: raw }; }
    const content = payload?.choices?.[0]?.message?.content
      ?? payload?.choices?.[0]?.text
      ?? payload?.output_text
      ?? payload?.text
      ?? '';
    const answer = (Array.isArray(content)
      ? content.map(part => typeof part === 'string' ? part : part?.text || '').join('\n')
      : String(content || '')).trim();
    if (!answer) throw new Error('Provider mengirim jawaban kosong');
    return answer.slice(0, 3400);
  } finally {
    clearTimeout(timeout);
  }
}

function getProviderChain(settings) {
  const config = resolveAIConfiguration(settings);
  const primary = config.mode === 'custom'
    ? [{ name: 'AI Manual', endpoint: config.endpoint, model: config.model, apiKey: config.apiKey }]
    : (config.apiKey ? [{ name: 'Pollinations AI', endpoint: POLLINATIONS_ENDPOINT, model: POLLINATIONS_MODEL, apiKey: config.apiKey, timeout: 15000 }] : []);
  return [...primary, ...FREE_FALLBACKS];
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
  const answer = await askFreeAI('Balas tepat: Koneksi AI DAFZZ aktif.', { includePrefix: false, requesterIp: 'admin-test' });
  const ok = Boolean(answer) && !isFallbackAIResponse(answer);
  return { ok, answer, configuration: resolveAIConfiguration(getDb().settings), fallbackCount: FREE_FALLBACKS.length };
}

export function getAIFallbackProviders() {
  return FREE_FALLBACKS.map(({ name, endpoint, model }) => ({ name, endpoint, model }));
}
