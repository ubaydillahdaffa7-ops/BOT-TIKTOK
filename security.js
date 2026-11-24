import crypto from 'node:crypto';

export function verifyTikTokBridgeSignature(rawBody, headers, secret) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  const header = String(headers['x-ttdm-signature'] || '');
  const idHeader = String(headers['x-ttdm-event-id'] || '');
  const match = header.match(/^t=(\d+),v1=([a-f0-9]{64})$/i);
  if (!match || !idHeader) return false;
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(String(timestamp) + '.')
    .update(rawBody)
    .digest('hex');
  const actual = Buffer.from(match[2], 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

export function safeFileName(value = 'hasil.bin') {
  const base = String(value).split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').trim();
  const safe = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\s+/g, '-').slice(0, 120);
  return safe && safe !== '.' && safe !== '..' ? safe : 'hasil.bin';
}

export function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch { return false; }
}
