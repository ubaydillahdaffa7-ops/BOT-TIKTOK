import { getDb, logActivity, persist } from './store.js';

// Preserve the exact legacy endpoint from the DAFZZ AI v3.0 code the user tested.
// The current Pollinations API is also configurable through the custom mode.
const POLLINATIONS_ENDPOINT = 'https://text.pollinations.ai/openai';
const POLLINATIONS_MODEL = 'openai';
const SYSTEM_PROMPT = [
  'Kamu adalah DAFZZ BOT, asisten percakapan yang ramah dan membantu pengguna Indonesia.',
  'Jawab dalam bahasa Indonesia yang natural, jelas, relevan, dan tidak bertele-tele.',
  'Jangan gunakan emoji. Jangan mengaku bisa menjalankan fitur yang belum tersedia.',
  'DAFZZ memiliki 300 tools dalam enam kategori: Foto & Desain, Teks & Data, Dokumen & File, Konverter & Kalkulator, Keamanan & Privasi, Web & Developer.',
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

export async function askFreeAI(userText, context = {}) {
  const settings = getDb().settings;
  const prefix = settings.fallbackPrefix || 'Maaf kamu ngetik apa mpruy';
  if (!settings.aiEnabled) return getFallback(prefix, 'Fitur AI sedang dinonaktifkan. Ketik .menu untuk melihat perintah yang tersedia.');

  const config = resolveAIConfiguration(settings);
  if (!config.endpoint || !config.model) return getFallback(prefix, 'Konfigurasi AI belum lengkap. Hubungi administrator.');

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
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
      throw new Error(`AI endpoint HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 160)}` : ''}`);
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
    if (!answer) throw new Error('AI tidak mengirim jawaban teks');
    return `${prefix}\n${answer.slice(0, 3400)}`;
  } catch (error) {
    console.warn('[ai-fallback]', error?.message || error);
    logActivity('ai_error', error?.name === 'AbortError' ? 'AI terlalu lama merespons' : 'Layanan AI gagal memberikan jawaban');
    await persist().catch(() => {});
    if (error?.name === 'AbortError') return getFallback(prefix, 'Layanan AI terlalu lama merespons. Coba lagi nanti atau ketik .menu.');
    return getFallback(prefix, 'AI tidak dapat menjawab saat ini. Coba lagi nanti atau ketik .menu.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function testFreeAI() {
  const answer = await askFreeAI('Balas tepat: Koneksi AI DAFZZ aktif.', { requesterIp: 'admin-test' });
  const ok = Boolean(answer) && !isFallbackAIResponse(answer);
  return { ok, answer, configuration: resolveAIConfiguration(getDb().settings) };
}
