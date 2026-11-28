/* =========================================================
   SÉCURITÉ & VALIDATION (OWASP, CORS strict, Rate-Limit D1, Turnstile)
   ========================================================= */

import { sha256Hex } from './crypto.js';

export const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const EMAIL_RE = /^[^\s@<>,"'\\]{1,64}@[^\s@<>,"'\\]{1,189}\.[a-zA-Z]{2,24}$/;

const COMMON_WEAK_PASSWORDS = new Set([
  '1234567890', '0123456789', '12345678901', 'password123', 'password1234',
  'motdepasse', 'motdepasse1', 'motdepasse123', 'azerty1234', 'azertyuiop',
  'qwerty1234', 'qwertyuiop', 'admin12345', 'welcome123', 'bonjour123',
  'mapriere123', 'jesuschrist', 'saintjoseph', 'alleluia123', 'priere1234'
]);

export function normalizeEmail(raw) {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean.length < 5 || clean.length > 254 || !EMAIL_RE.test(clean)) {
    return null;
  }
  return clean;
}

export function validatePasswordStrength(password, emailNormalized = '') {
  const pw = String(password || '');
  if (pw.length < 10) {
    return 'Le mot de passe doit contenir au moins 10 caractères.';
  }
  if (pw.length > 128) {
    return 'Le mot de passe ne doit pas dépasser 128 caractères.';
  }
  const low = pw.toLowerCase().replace(/\s+/g, '');
  if (COMMON_WEAK_PASSWORDS.has(low)) {
    return 'Ce mot de passe est trop courant. Choisissez une phrase secrète plus personnelle.';
  }
  if (/^(.)\1+$/.test(pw)) {
    return 'Le mot de passe ne peut pas être composé d’un seul caractère répété.';
  }
  const localPart = String(emailNormalized).split('@')[0] || '';
  if (localPart.length >= 4 && low.includes(localPart)) {
    return 'Le mot de passe ne doit pas contenir votre adresse e-mail.';
  }
  return null;
}

export function getAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;

  const prodOrigin = (env.APP_ORIGIN || 'https://josephdecacqueray.github.io').replace(/\/$/, '');
  if (origin === prodOrigin) return origin;

  // Origines locales autorisées UNIQUEMENT en mode développement local
  if (env.ENVIRONMENT === 'development') {
    if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/.test(origin)) {
      return origin;
    }
  }
  return null;
}

export function buildSecurityHeaders(allowedOrigin) {
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Vary': 'Origin'
  });
  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Max-Age', '600');
  }
  return headers;
}

export function jsonResponse(data, status, allowedOrigin, extraHeaders = {}) {
  const headers = buildSecurityHeaders(allowedOrigin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers.set(k, String(v));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export async function readJsonBounded(request, maxBytes) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > maxBytes) {
    const err = new Error('PAYLOAD_TOO_LARGE');
    err.status = 413;
    throw err;
  }

  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignoré */ }
      const err = new Error('PAYLOAD_TOO_LARGE');
      err.status = 413;
      throw err;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  const text = new TextDecoder().decode(merged).trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error('INVALID_JSON');
      err.status = 400;
      throw err;
    }
    return parsed;
  } catch {
    const err = new Error('INVALID_JSON');
    err.status = 400;
    throw err;
  }
}

export function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

export async function hashClientIp(request, env) {
  const ip = getClientIp(request);
  const dayBucket = new Date().toISOString().slice(0, 10);
  const pepper = env.JWT_SIGNING_KEY || 'local-dev-pepper';
  const digest = await sha256Hex(`${ip}|${dayBucket}|${pepper}`);
  return digest.slice(0, 32);
}

export async function checkRateLimit(db, bucketKey, maxCount, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare('SELECT count, window_start, expires_at FROM rate_limits WHERE bucket_key = ?')
    .bind(bucketKey)
    .first();

  if (!row || row.expires_at <= now) {
    const expiresAt = now + windowSec;
    await db
      .prepare(
        'INSERT INTO rate_limits (bucket_key, count, window_start, expires_at) VALUES (?, 1, ?, ?) ' +
        'ON CONFLICT(bucket_key) DO UPDATE SET count = 1, window_start = excluded.window_start, expires_at = excluded.expires_at'
      )
      .bind(bucketKey, now, expiresAt)
      .run();
    return { allowed: true, remaining: Math.max(0, maxCount - 1), retryAfterSec: 0 };
  }

  if (row.count >= maxCount) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, row.expires_at - now)
    };
  }

  await db
    .prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket_key = ?')
    .bind(bucketKey)
    .run();

  return {
    allowed: true,
    remaining: Math.max(0, maxCount - (row.count + 1)),
    retryAfterSec: 0
  };
}

export async function verifyTurnstile(token, ip, env, fetchImpl = fetch) {
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) {
    // En développement local sans clé secrète : autorisé sauf token de test explicitement invalide
    if (env.ENVIRONMENT === 'development') {
      return token !== 'FORCE_TURNSTILE_FAIL';
    }
    // En production sans clé secrète encore configurée : on laisse fonctionner jusqu'à configuration de la clé
    return true;
  }

  if (!token || typeof token !== 'string' || token.length > 2048) {
    return false;
  }

  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (ip) form.set('remoteip', ip);

    const resp = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return Boolean(data?.success);
  } catch {
    return false;
  }
}

export function sanitizeString(val, maxLen) {
  return String(val ?? '').slice(0, maxLen);
}
