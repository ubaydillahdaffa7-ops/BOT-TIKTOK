import { getDb } from './store.js';

const recentCalls = new Map();
const WINDOW_MS = 60_000;
const MAX_CALLS_PER_IP_MODEL = 2;

function allowAnonymousCall(model, requesterIp) {
  const key = `${requesterIp || 'unknown'}:${model}`;
  const now = Date.now();
  const history = (recentCalls.get(key) || []).filter(time => now - time < WINDOW_MS);
  if (history.length >= MAX_CALLS_PER_IP_MODEL) return false;
  history.push(now);
  recentCalls.set(key, history);
  return true;
}

export async function askFreeAI(userText, context = {}) {
  const settings = getDb().settings;
  const prefix = settings.fallbackPrefix || 'Maaf kamu ngetik apa mpruy';
  const safeFallback = `${prefix}\nAku belum bisa memahami pesan itu. Ketik .menu untuk melihat perintah DAFZZ yang tersedia.`;
  if (!settings.aiEnabled) return safeFallback;

  const endpoint = settings.aiEndpoint || 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions';
  const model = settings.aiModel || 'Qwen3.6-27B';
  const ip = context.requesterIp || 'server';
  if (!allowAnonymousCall(model, ip)) return `${prefix}\nLayanan AI gratis sedang mencapai batas permintaan sementara. Coba lagi sebentar atau ketik .menu.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Kamu adalah asisten percakapan DAFZZ BOT. Jawab dalam bahasa Indonesia yang natural, santai, sopan, singkat, dan tidak kaku. Jangan gunakan emoji. Jangan mengaku bisa menjalankan fitur yang belum tersedia. DAFZZ memiliki 300 tools dalam 6 kategori: Foto & Desain, Teks & Data, Dokumen & File, Konverter & Kalkulator, Keamanan & Privasi, Web & Developer. Jika pengguna ingin memakai tool, arahkan untuk mengetik .menu atau nama perintah tool. Jika pesan tidak jelas, minta penjelasan singkat. Jangan meminta password, cookie, token, atau data rahasia.'
          },
          { role: 'user', content: String(userText).slice(0, 2500) }
        ],
        temperature: 0.6,
        max_tokens: 180,
        stream: false
      })
    });
    if (!response.ok) throw new Error(`AI endpoint HTTP ${response.status}`);
    const payload = await response.json();
    const answer = payload?.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('AI tidak mengirim jawaban teks');
    return `${prefix}\n${answer.slice(0, 3000)}`;
  } catch (error) {
    console.warn('[free-ai]', error?.message || error);
    if (error?.name === 'AbortError') return `${prefix}\nLayanan AI terlalu lama merespons. Coba lagi nanti atau ketik .menu.`;
    return safeFallback;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testFreeAI() {
  return askFreeAI('Balas tepat: Koneksi AI DAFZZ aktif.', { requesterIp: 'tiktok-bridge' });
}
