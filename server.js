import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import { DATA_DIR, getDb, getSessionSecret, initStore, makePasswordRecord, persist, pruneExpired, randomToken, verifyPassword } from './store.js';
import { verifyTikTokBridgeSignature, safeFileName, isValidHttpUrl } from './security.js';
import { handleTikTokEvent, getCatalogStats, findCatalogTool, sendTikTokText } from './bot.js';
import { testFreeAI } from './ai.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.resolve('.');
const OUTPUT_DIR = path.join(DATA_DIR, 'outputs');
await initStore();
await fs.mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const sessionSecret = await getSessionSecret();
app.use(session({
  name: 'dafzz.admin',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: 'auto',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 8 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname || file.originalname.length > 180) return cb(new Error('Nama file tidak valid.'));
    cb(null, true);
  }
});

function isAdmin(req) { return req.session?.admin === true; }
function sendError(res, status, message) { return res.status(status).json({ ok: false, error: message }); }
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return sendError(res, 401, 'Silakan login ke Admin DAFZZ.');
  next();
}
function ensureCsrf(req, res, next) {
  const token = req.get('X-CSRF-Token');
  if (!req.session?.csrfToken || token !== req.session.csrfToken) return sendError(res, 403, 'Sesi keamanan kedaluwarsa. Muat ulang halaman.');
  next();
}
function publicOrigin(req) {
  const configured = getDb().settings.publicBaseUrl || process.env.APP_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto')?.split(',')[0] || req.protocol;
  return `${proto}://${req.get('host')}`;
}
function makeDownloadToken(fileRecord) {
  const token = randomToken(28);
  getDb().downloads[token] = fileRecord;
  return token;
}

// The bridge signs the exact raw bytes. Do not parse and re-serialize before checking HMAC.
app.post('/webhooks/tiktok', express.raw({ type: 'application/json', limit: '64kb' }), async (req, res) => {
  const settings = getDb().settings;
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!verifyTikTokBridgeSignature(raw, req.headers, settings.webhookSecret)) {
    return res.status(401).send('Invalid webhook signature');
  }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch { return res.status(400).send('Invalid JSON'); }
  const headerId = String(req.get('X-TTDM-Event-ID') || '');
  if (!headerId || String(event.id || '') !== headerId) return res.status(401).send('Event ID mismatch');
  const db = getDb();
  if (db.processedEvents[headerId]?.status === 'done') return res.status(200).json({ accepted: true, duplicate: true });
  try {
    db.processedEvents[headerId] = { status: 'processing', createdAt: Date.now() };
    await persist();
    await handleTikTokEvent(event, publicOrigin(req));
    db.processedEvents[headerId] = { status: 'done', createdAt: Date.now() };
    await persist();
    return res.status(200).json({ accepted: true });
  } catch (error) {
    delete db.processedEvents[headerId];
    await persist();
    console.error('[tiktok-webhook]', error?.message || error);
    return res.status(500).json({ accepted: false });
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, app: 'DAFZZ TikTok Bot', tools: getCatalogStats().total }));
app.get('/api/catalog', (_req, res) => res.json(getCatalogStats()));

app.get('/api/admin/state', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomToken(24);
  res.json({
    setupRequired: !getDb().admin,
    setupTokenRequired: !getDb().admin && Boolean(process.env.ADMIN_SETUP_TOKEN),
    authenticated: isAdmin(req),
    csrfToken: req.session.csrfToken
  });
});

function secretMatches(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

const loginAttempts = new Map();
function loginLocked(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil > Date.now()) return true;
  if (entry.lockedUntil) loginAttempts.delete(ip);
  return false;
}
function failLogin(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) { entry.lockedUntil = Date.now() + 15 * 60 * 1000; entry.count = 0; }
  loginAttempts.set(ip, entry);
}

app.post('/api/admin/setup', ensureCsrf, async (req, res) => {
  if (getDb().admin) return sendError(res, 409, 'Admin sudah dibuat. Silakan login.');
  const expectedSetupToken = process.env.ADMIN_SETUP_TOKEN || '';
  if (!expectedSetupToken || !secretMatches(req.body?.setupToken, expectedSetupToken)) {
    return sendError(res, 403, 'Setup token tidak cocok. Ambil ADMIN_SETUP_TOKEN dari file .env di server.');
  }
  const password = String(req.body?.password || '');
  if (password.length < 12) return sendError(res, 400, 'Password admin minimal 12 karakter.');
  if (password.length > 200) return sendError(res, 400, 'Password terlalu panjang.');
  getDb().admin = makePasswordRecord(password);
  await persist();
  req.session.admin = true;
  req.session.csrfToken = randomToken(24);
  return res.json({ ok: true });
});

app.post('/api/admin/login', ensureCsrf, async (req, res) => {
  const ip = req.ip || 'unknown';
  if (loginLocked(ip)) return sendError(res, 429, 'Terlalu banyak percobaan. Coba lagi setelah 15 menit.');
  const password = String(req.body?.password || '');
  if (!verifyPassword(password, getDb().admin)) {
    failLogin(ip);
    return sendError(res, 401, 'Password admin tidak cocok.');
  }
  loginAttempts.delete(ip);
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.admin = true;
  req.session.csrfToken = randomToken(24);
  return res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, ensureCsrf, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  const db = getDb();
  const catalog = getCatalogStats();
  let bridge = { configured: Boolean(db.settings.bridgeApiToken && db.settings.webhookSecret), connected: false, note: 'Belum diuji' };
  if (db.settings.bridgeApiToken) {
    try {
      const response = await fetch(`${db.settings.bridgeBaseUrl.replace(/\/$/, '')}/readyz`, {
        headers: { Authorization: `Bearer ${db.settings.bridgeApiToken}` },
        signal: AbortSignal.timeout(3000)
      });
      bridge.connected = response.ok;
      bridge.note = response.ok ? 'Bridge siap menerima DM' : `Bridge merespons HTTP ${response.status}`;
    } catch { bridge.note = 'Bridge belum dapat dijangkau'; }
  }
  res.json({
    catalog,
    stats: db.stats,
    bridge,
    ai: { enabled: db.settings.aiEnabled, endpoint: db.settings.aiEndpoint, model: db.settings.aiModel, mode: 'anonymous-no-key' },
    settings: {
      bridgeBaseUrl: db.settings.bridgeBaseUrl,
      bridgeTokenSet: Boolean(db.settings.bridgeApiToken),
      webhookSecretSet: Boolean(db.settings.webhookSecret),
      aiEnabled: db.settings.aiEnabled,
      aiEndpoint: db.settings.aiEndpoint,
      aiModel: db.settings.aiModel,
      fallbackPrefix: db.settings.fallbackPrefix,
      publicBaseUrl: db.settings.publicBaseUrl
    }
  });
});

app.post('/api/admin/settings', requireAdmin, ensureCsrf, async (req, res) => {
  const body = req.body || {};
  const settings = getDb().settings;
  if (typeof body.bridgeBaseUrl === 'string' && body.bridgeBaseUrl.trim()) {
    if (!isValidHttpUrl(body.bridgeBaseUrl.trim())) return sendError(res, 400, 'Alamat bridge harus URL HTTP atau HTTPS yang valid.');
    settings.bridgeBaseUrl = body.bridgeBaseUrl.trim().replace(/\/$/, '');
  }
  if (typeof body.bridgeApiToken === 'string' && body.bridgeApiToken.trim()) settings.bridgeApiToken = body.bridgeApiToken.trim();
  if (typeof body.webhookSecret === 'string' && body.webhookSecret.trim()) settings.webhookSecret = body.webhookSecret.trim();
  if (body.clearBridgeToken === true) settings.bridgeApiToken = '';
  if (body.clearWebhookSecret === true) settings.webhookSecret = '';
  if (typeof body.aiEnabled === 'boolean') settings.aiEnabled = body.aiEnabled;
  if (typeof body.aiEndpoint === 'string' && body.aiEndpoint.trim()) {
    if (!isValidHttpUrl(body.aiEndpoint.trim()) || !body.aiEndpoint.startsWith('https://')) return sendError(res, 400, 'Endpoint AI harus URL HTTPS.');
    settings.aiEndpoint = body.aiEndpoint.trim();
  }
  if (typeof body.aiModel === 'string' && /^[\w./:-]{2,120}$/.test(body.aiModel.trim())) settings.aiModel = body.aiModel.trim();
  if (typeof body.fallbackPrefix === 'string' && body.fallbackPrefix.trim().length <= 120) settings.fallbackPrefix = body.fallbackPrefix.trim();
  if (typeof body.publicBaseUrl === 'string') {
    const value = body.publicBaseUrl.trim();
    if (value && (!isValidHttpUrl(value) || !value.startsWith('https://'))) return sendError(res, 400, 'URL publik harus HTTPS.');
    settings.publicBaseUrl = value.replace(/\/$/, '');
  }
  await persist();
  return res.json({ ok: true });
});

app.post('/api/admin/test-bridge', requireAdmin, ensureCsrf, async (_req, res) => {
  const settings = getDb().settings;
  if (!settings.bridgeApiToken) return sendError(res, 400, 'Isi token bridge terlebih dahulu.');
  try {
    const response = await fetch(`${settings.bridgeBaseUrl.replace(/\/$/, '')}/readyz`, {
      headers: { Authorization: `Bearer ${settings.bridgeApiToken}` },
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return sendError(res, response.status, data.detail || 'Bridge belum siap.');
    return res.json({ ok: true, status: data });
  } catch (error) { return sendError(res, 502, error.message || 'Bridge tidak dapat dijangkau.'); }
});

app.post('/api/admin/test-ai', requireAdmin, ensureCsrf, async (_req, res) => {
  const answer = await testFreeAI();
  const fallback = answer.includes('belum bisa memahami') || answer.includes('mencapai batas') || answer.includes('terlalu lama') || answer.includes('Coba lagi nanti');
  return res.json({ ok: !fallback, answer, note: fallback ? 'AI belum berhasil menjawab; periksa endpoint, model, atau batas permintaan gratis.' : 'AI memberi respons.' });
});

app.post('/api/run/:token/result', upload.single('file'), async (req, res) => {
  const db = getDb();
  pruneExpired();
  const runSession = db.sessions[req.params.token];
  if (!runSession || runSession.expiresAt <= Date.now()) return sendError(res, 410, 'Sesi DAFZZ sudah kedaluwarsa. Jalankan perintah tool lagi dari TikTok.');
  let buffer;
  let fileName;
  let mime;
  if (req.file) {
    buffer = req.file.buffer;
    fileName = safeFileName(req.file.originalname);
    mime = req.file.mimetype || 'application/octet-stream';
  } else {
    const outputText = String(req.body?.text || '');
    if (!outputText || outputText.length > 500_000) return sendError(res, 400, 'Hasil teks kosong atau terlalu besar.');
    buffer = Buffer.from(outputText, 'utf8');
    fileName = safeFileName(req.body?.filename || 'hasil.txt');
    mime = 'text/plain; charset=utf-8';
  }
  const diskName = `${crypto.randomUUID()}-${fileName}`;
  const diskPath = path.join(OUTPUT_DIR, diskName);
  await fs.writeFile(diskPath, buffer, { mode: 0o600 });
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const downloadToken = makeDownloadToken({ fileName, diskPath, mime, size: buffer.length, expiresAt, conversationId: runSession.conversationId });
  runSession.lastDownloadToken = downloadToken;
  runSession.lastResultAt = Date.now();
  runSession.state = 'result-ready';
  db.stats.outputs += 1;
  await persist();

  const base = publicOrigin(req);
  const link = `${base}/download/${downloadToken}`;
  const tool = findCatalogTool(runSession.toolSlug);
  const reply = [
    `DAFZZ - HASIL ${tool?.name?.toUpperCase() || 'TOOL'}`,
    'Proses selesai. File hasil dapat diunduh melalui tautan ini:',
    link,
    '',
    `Nama file: ${fileName}`,
    `Ukuran: ${(buffer.length / 1024).toFixed(1)} KB`,
    'Tautan berlaku 24 jam.'
  ].join('\n');
  let sent = false;
  try {
    const key = crypto.createHash('sha256').update(`${req.params.token}:${diskName}`).digest('hex');
    await sendTikTokText(runSession.conversationId, reply, `result:${key}`);
    sent = true;
  } catch (error) {
    console.error('[result-notify]', error?.message || error);
  }
  return res.json({ ok: true, fileName, size: buffer.length, downloadUrl: link, notifiedTikTok: sent });
});

app.get('/api/run/:token/status', (req, res) => {
  const runSession = getDb().sessions[req.params.token];
  if (!runSession || runSession.expiresAt <= Date.now()) return sendError(res, 404, 'Sesi tidak ditemukan.');
  res.json({ ok: true, toolSlug: runSession.toolSlug, state: runSession.state, expiresAt: runSession.expiresAt });
});

app.get('/download/:token', async (req, res) => {
  pruneExpired();
  const record = getDb().downloads[req.params.token];
  if (!record || record.expiresAt <= Date.now()) return res.status(404).send('Tautan unduhan tidak ditemukan atau sudah kedaluwarsa.');
  try {
    await fs.access(record.diskPath);
    res.setHeader('Content-Type', record.mime || 'application/octet-stream');
    res.setHeader('Content-Length', record.size);
    res.setHeader('Content-Disposition', `attachment; filename="${record.fileName.replace(/["\\\r\n]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(record.diskPath);
  } catch { return res.status(404).send('File hasil sudah tidak tersedia.'); }
});

app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/run/:token', (req, res) => {
  const entry = getDb().sessions[req.params.token];
  if (!entry || entry.expiresAt <= Date.now()) return res.status(410).send('Sesi tool kedaluwarsa. Jalankan perintah tool kembali dari TikTok.');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.get('/upload', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use(express.static(PUBLIC_DIR, { index: 'index.html', dotfiles: 'ignore', etag: true, maxAge: '1h' }));

app.use((error, _req, res, _next) => {
  console.error('[server]', error?.stack || error);
  if (error instanceof multer.MulterError) return sendError(res, error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'File hasil melebihi batas 30 MB.' : 'Upload tidak valid.');
  return sendError(res, 500, 'Terjadi kesalahan pada server.');
});

setInterval(async () => {
  const db = getDb();
  const before = Object.keys(db.downloads).length;
  pruneExpired();
  if (Object.keys(db.downloads).length !== before) await persist();
  try {
    const files = await fs.readdir(OUTPUT_DIR);
    const livePaths = new Set(Object.values(db.downloads).map(item => item.diskPath));
    for (const name of files) {
      const target = path.join(OUTPUT_DIR, name);
      if (!livePaths.has(target)) await fs.unlink(target).catch(() => {});
    }
  } catch { /* cleanup is best effort */ }
}, 60 * 60 * 1000).unref();

app.listen(PORT, '0.0.0.0', () => {
  const catalog = getCatalogStats();
  console.log(`DAFZZ web/bot listening on :${PORT}; catalog=${catalog.total}, categories=${catalog.categories.length}`);
});
