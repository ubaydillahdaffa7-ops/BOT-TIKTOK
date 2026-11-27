import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.APP_DATA_DIR || '.data');
const DB_FILE = path.join(DATA_DIR, 'state.json');
const DEFAULTS = {
  admin: null,
  settings: {
    bridgeBaseUrl: process.env.TIKTOK_BRIDGE_URL || 'http://tiktok-bridge:8000',
    bridgeApiToken: '',
    webhookSecret: '',
    botEnabled: true,
    aiEnabled: true,
    aiMode: 'pollinations',
    aiEndpoint: 'https://text.pollinations.ai/openai',
    aiModel: 'openai',
    aiApiKey: '',
    fallbackPrefix: 'Maaf kamu ngetik apa mpruy',
    publicBaseUrl: process.env.APP_PUBLIC_URL || '',
    telegramBotToken: '',
    telegramUpdateOffset: 0,
    platforms: {
      tiktok: { riskAcceptedAt: null },
      telegram: { enabled: false, riskAcceptedAt: null },
      whatsapp: { enabled: false, riskAcceptedAt: null }
    }
  },
  sessions: {},
  downloads: {},
  processedEvents: {},
  stats: { received: 0, replied: 0, aiReplies: 0, toolLinks: 0, outputs: 0, byPlatform: { tiktok: 0, whatsapp: 0, telegram: 0 } },
  logs: []
};

let db = structuredClone(DEFAULTS);
let writeQueue = Promise.resolve();

export async function initStore() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    const stored = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
    db = {
      ...structuredClone(DEFAULTS), ...stored,
      settings: { ...DEFAULTS.settings, ...(stored.settings || {}), platforms: { ...DEFAULTS.settings.platforms, ...(stored.settings?.platforms || {}) } },
      stats: { ...DEFAULTS.stats, ...(stored.stats || {}), byPlatform: { ...DEFAULTS.stats.byPlatform, ...(stored.stats?.byPlatform || {}) } },
      logs: Array.isArray(stored.logs) ? stored.logs.slice(0, 120) : []
    };
    for (const platform of ['tiktok', 'telegram', 'whatsapp']) {
      db.settings.platforms[platform] = { ...DEFAULTS.settings.platforms[platform], ...(stored.settings?.platforms?.[platform] || {}) };
    }
    // Migrate the previous OVH/Qwen anonymous-AI defaults to the Pollinations
    // configuration requested for this build. Custom mode is explicit.
    if (!stored.settings?.aiMode && String(stored.settings?.aiEndpoint || '').includes('ovh.endpoints')) {
      db.settings.aiMode = 'pollinations';
      db.settings.aiEndpoint = 'https://text.pollinations.ai/openai';
      db.settings.aiModel = 'openai';
      db.settings.aiApiKey = '';
    }
    if (!['pollinations', 'custom'].includes(db.settings.aiMode)) db.settings.aiMode = 'pollinations';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await persist();
  }
  await fs.chmod(DATA_DIR, 0o700).catch(() => {});
}

export function getDb() { return db; }

export function logActivity(type, message) {
  if (!Array.isArray(db.logs)) db.logs = [];
  db.logs.unshift({
    id: crypto.randomUUID(),
    type: String(type || 'info').slice(0, 32),
    message: String(message || '').slice(0, 220),
    at: new Date().toISOString()
  });
  db.logs = db.logs.slice(0, 120);
}

export function persist() {
  const snapshot = JSON.stringify(db, null, 2);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, snapshot, { mode: 0o600 });
    await fs.rename(tmp, DB_FILE);
    await fs.chmod(DB_FILE, 0o600).catch(() => {});
  });
  return writeQueue;
}

export function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }

export function pruneExpired(now = Date.now()) {
  for (const [token, entry] of Object.entries(db.sessions)) {
    if (!entry.expiresAt || entry.expiresAt <= now) delete db.sessions[token];
  }
  for (const [token, entry] of Object.entries(db.downloads)) {
    if (!entry.expiresAt || entry.expiresAt <= now) delete db.downloads[token];
  }
  for (const [eventId, entry] of Object.entries(db.processedEvents)) {
    if (!entry.createdAt || entry.createdAt < now - 7 * 86400000) delete db.processedEvents[eventId];
  }
}

export function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: new Date().toISOString() };
}

export function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(record.salt, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function getSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'session-secret');
  try { return await fs.readFile(file, 'utf8'); }
  catch {
    const secret = randomToken(48);
    await fs.writeFile(file, secret, { mode: 0o600, flag: 'wx' }).catch(async () => {});
    return fs.readFile(file, 'utf8');
  }
}
