/* =========================================================
   CRYPTOGRAPHIE DURCIE (100 % Web Crypto natif Cloudflare Workers)
   - PBKDF2-SHA256 à 100 000 itérations + sel aléatoire 16 octets
   - Comparaison en temps constant
   - JWT HS256 strict (rejet alg: none)
   - Clés de récupération haute entropie (>= 128 bits)
   ========================================================= */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const PBKDF2_ITERATIONS = 100000;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function b64uEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i += 1) {
    bin += String.fromCharCode(arr[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function b64uDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) {
    throw new Error('INVALID_B64U');
  }
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function randomBytes(len) {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

export function randomToken(byteLen = 32) {
  return b64uEncode(randomBytes(byteLen));
}

export function timingSafeEqual(a, b) {
  const ba = typeof a === 'string' ? encoder.encode(a) : new Uint8Array(a);
  const bb = typeof b === 'string' ? encoder.encode(b) : new Uint8Array(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i += 1) {
    diff |= ba[i] ^ bb[i];
  }
  return diff === 0;
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let hex = '';
  for (let i = 0; i < digest.length; i += 1) {
    hex += digest[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export async function hashPassword(password, existingSaltB64u = null) {
  const salt = existingSaltB64u ? b64uDecode(existingSaltB64u) : randomBytes(16);
  const keyMat = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMat,
    256
  );
  return {
    salt: b64uEncode(salt),
    hash: b64uEncode(new Uint8Array(derived))
  };
}

export async function verifyPassword(password, saltB64u, expectedHashB64u) {
  try {
    const { hash } = await hashPassword(password, saltB64u);
    return timingSafeEqual(hash, expectedHashB64u);
  } catch {
    return false;
  }
}

// Homogénéisation temporelle anti-énumération (exécute le même coût PBKDF2 quand le compte est absent)
export async function dummyPasswordWork() {
  const fakeSalt = b64uEncode(new Uint8Array(16).fill(7));
  await hashPassword('dummy-timing-shield-v8', fakeSalt);
}

// Clé de récupération 160 bits (32 caractères Base32 non ambigus -> 8 blocs de 4)
export function generateRecoveryKey() {
  const bytes = randomBytes(32);
  let chars = '';
  for (let i = 0; i < 32; i += 1) {
    chars += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return chars.match(/.{1,4}/g).join('-');
}

export function normalizeRecoveryKey(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

async function importHmacKey(secret, usage) {
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET_NOT_CONFIGURED');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

export async function signJwt(payload, secret, ttlSec = 1800) {
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = b64uEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const bodyObj = {
    ...payload,
    iat: now,
    exp: now + ttlSec
  };
  const bodyB64 = b64uEncode(encoder.encode(JSON.stringify(bodyObj)));
  const signingInput = `${headerB64}.${bodyB64}`;
  const key = await importHmacKey(secret, 'sign');
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)));
  return `${signingInput}.${b64uEncode(sig)}`;
}

export async function verifyJwt(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;
  if (!headerB64 || !bodyB64 || !sigB64) return null;

  let header;
  let body;
  let sigBytes;
  try {
    header = JSON.parse(decoder.decode(b64uDecode(headerB64)));
    body = JSON.parse(decoder.decode(b64uDecode(bodyB64)));
    sigBytes = b64uDecode(sigB64);
  } catch {
    return null;
  }

  // Rejet explicite de alg: none et de tout algorithme autre que HS256
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }

  try {
    const key = await importHmacKey(secret, 'verify');
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`${headerB64}.${bodyB64}`));
    if (!ok) return null;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!body || typeof body.exp !== 'number' || body.exp <= now) return null;
  if (typeof body.sub !== 'string' || typeof body.sid !== 'string') return null;

  return body;
}
