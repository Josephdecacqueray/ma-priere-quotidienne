/* =========================================================
   WEB PUSH MULTI-UTILISATEURS (RFC 8291 aes128gcm + VAPID ES256)
   100 % Web Crypto natif Cloudflare Workers — Zéro polyfill Node
   Scalable 1 000 comptes : lots stricts <= 40 envois par Cron (limite Free = 50 fetch)
   ========================================================= */

import { b64uEncode, b64uDecode, randomBytes, sha256Hex } from './crypto.js';
import { readJsonBounded, jsonResponse, sanitizeString } from './security.js';

const encoder = new TextEncoder();

function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.byteLength;
  }
  return out;
}

async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
}

async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const input = concatBytes(info, new Uint8Array([1]));
  const full = new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
  return full.slice(0, length);
}

// Chiffrement Web Push conforme RFC 8291 + RFC 8188 (Content-Encoding: aes128gcm)
export async function encryptWebPushPayload(payloadStr, p256dhB64u, authB64u) {
  const uaPublicBytes = b64uDecode(p256dhB64u);
  const authSecret = b64uDecode(authB64u);
  if (uaPublicBytes.length !== 65 || uaPublicBytes[0] !== 4 || authSecret.length < 16) {
    throw new Error('INVALID_PUSH_KEYS');
  }

  const uaPubKey = await crypto.subtle.importKey(
    'raw',
    uaPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asKeyPair.privateKey, 256)
  );

  // RFC 8291 § 3.3 : IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\0" || ua_pub || as_pub, 32)
  const keyInfo = concatBytes(encoder.encode('WebPush: info\0'), uaPublicBytes, asPublicBytes);
  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // RFC 8188 : salt (16 octets), CEK (16 octets), NONCE (12 octets)
  const salt = randomBytes(16);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, encoder.encode('Content-Encoding: nonce\0'), 12);

  // Plaintext + délimiteur final 0x02 (RFC 8188)
  const plainBytes = concatBytes(encoder.encode(payloadStr), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plainBytes)
  );

  // En-tête aes128gcm : salt (16) || rs (4, uint32 BE = 4096) || idlen (1 = 65) || keyid (65)
  const rsBytes = new Uint8Array([0, 0, 16, 0]);
  const header = concatBytes(salt, rsBytes, new Uint8Array([asPublicBytes.length]), asPublicBytes);
  return concatBytes(header, ciphertext);
}

// Signature JWT VAPID ES256 (RFC 8292)
export async function buildVapidAuthHeader(endpoint, env) {
  const pubB64u = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privB64u = String(env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.VAPID_SUBJECT || 'mailto:noreply@ma-priere-quotidienne.app').trim();
  if (!pubB64u || !privB64u) {
    throw new Error('VAPID_NOT_CONFIGURED');
  }

  const pubBytes = b64uDecode(pubB64u);
  if (pubBytes.length !== 65 || pubBytes[0] !== 4) {
    throw new Error('INVALID_VAPID_PUBLIC_KEY');
  }

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64uEncode(pubBytes.slice(1, 33)),
    y: b64uEncode(pubBytes.slice(33, 65)),
    d: privB64u
  };

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const headerB64 = b64uEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claimsB64 = b64uEncode(encoder.encode(JSON.stringify({ aud, exp, sub: subject })));
  const signingInput = `${headerB64}.${claimsB64}`;

  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(signingInput))
  );
  const jwt = `${signingInput}.${b64uEncode(sig)}`;
  return `vapid t=${jwt}, k=${pubB64u}`;
}

export async function sendEncryptedPush(sub, payloadObj, env, fetchImpl = fetch) {
  const encryptedBody = await encryptWebPushPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
  const authorization = await buildVapidAuthHeader(sub.endpoint, env);

  const resp = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      TTL: '86400',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      Urgency: 'normal'
    },
    body: encryptedBody
  });

  return { ok: resp.ok, status: resp.status };
}

function isValidPushEndpoint(endpoint) {
  try {
    const u = new URL(String(endpoint || ''));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    // Anti-SSRF : bloque localhost et plages privées
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(host) ||
      host === '::1'
    ) {
      return false;
    }
    return u.href.length <= 2000;
  } catch {
    return false;
  }
}

export async function handlePushSubscribe(request, env, origin, auth) {
  const body = await readJsonBounded(request, 16384);
  const sub = body.subscription;
  if (!sub || !isValidPushEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
    return jsonResponse({ error: 'Abonnement Push invalide.' }, 400, origin);
  }

  // Vérification format des clés cryptographiques
  try {
    const p256 = b64uDecode(sub.keys.p256dh);
    const authB = b64uDecode(sub.keys.auth);
    if (p256.length !== 65 || p256[0] !== 4 || authB.length < 16) {
      return jsonResponse({ error: 'Clés d’abonnement Push invalides.' }, 400, origin);
    }
  } catch {
    return jsonResponse({ error: 'Clés d’abonnement Push mal formées.' }, 400, origin);
  }

  const subId = (await sha256Hex(`${auth.userId}|${sub.endpoint}`)).slice(0, 40);
  const tzOffset = Math.max(-840, Math.min(840, Math.floor(Number(body.tzOffsetMinutes) || -60)));
  const timezone = sanitizeString(body.timezone || 'Europe/Paris', 64);
  const now = Date.now();

  await env.DB
    .prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, timezone, tz_offset_minutes, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(endpoint) DO UPDATE SET ' +
      'user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, timezone=excluded.timezone, ' +
      'tz_offset_minutes=excluded.tz_offset_minutes, updated_at=excluded.updated_at'
    )
    .bind(subId, auth.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, timezone, tzOffset, now, now)
    .run();

  return jsonResponse({ ok: true, id: subId }, 200, origin);
}

export async function handlePushUnsubscribe(request, env, origin, auth) {
  const body = await readJsonBounded(request, 8192);
  const endpoint = String(body.endpoint || '');
  if (endpoint) {
    await env.DB
      .prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
      .bind(endpoint, auth.userId)
      .run();
  }
  return jsonResponse({ ok: true }, 200, origin);
}

export async function handlePushTest(request, env, origin, auth, fetchImpl = fetch) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return jsonResponse(
      { ok: false, error: 'Les clés VAPID ne sont pas encore configurées sur le serveur.' },
      503,
      origin
    );
  }

  const rows = await env.DB
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? LIMIT 5')
    .bind(auth.userId)
    .all();

  let sent = 0;
  let removed = 0;
  const appUrl = env.APP_URL || 'https://josephdecacqueray.github.io/ma-priere-quotidienne/';

  for (const sub of rows.results || []) {
    try {
      const res = await sendEncryptedPush(
        sub,
        {
          title: 'Ma prière quotidienne',
          body: 'Les notifications Push sont actives pour vos neuvaines.',
          url: appUrl,
          tag: 'mpq-test'
        },
        env,
        fetchImpl
      );
      if (res.ok) sent += 1;
      else if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
        removed += 1;
      }
    } catch {
      // Ne jamais faire planter l'endpoint sur un échec de passerelle push
    }
  }

  return jsonResponse({ ok: true, sent, removed }, 200, origin);
}

function getLocalDateAndMinutes(utcMs, tzOffsetMinutes) {
  const localMs = utcMs - (Number(tzOffsetMinutes) || 0) * 60000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    localDate: `${y}-${m}-${day}`,
    localMinutes: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

function computeDayIndex(startDateStr, localDateStr) {
  const start = Date.parse(`${startDateStr}T00:00:00Z`);
  const cur = Date.parse(`${localDateStr}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(cur)) return 0;
  return Math.floor((cur - start) / 86400000) + 1;
}

// CRON MULTI-UTILISATEURS : plafonné strictement à 40 sous-requêtes fetch max par exécution (plan Free = 50)
export async function runDueRemindersCron(env, { nowUtc = Date.now(), fetchImpl = fetch } = {}) {
  const maxBatch = Math.max(1, Math.min(40, Number(env.MAX_PUSH_PER_CRON) || 40));
  const nowSec = Math.floor(nowUtc / 1000);

  // Nettoyage léger des compteurs rate_limit expirés et vieux logs push (> 7 jours)
  const sevenDaysAgo = new Date(nowUtc - 7 * 86400000).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(nowSec),
    env.DB.prepare('DELETE FROM push_sent_log WHERE local_date < ?').bind(sevenDaysAgo)
  ]);

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { ok: true, skipped: 'VAPID_NOT_CONFIGURED', sent: 0, remainingDue: 0, subrequests: 0 };
  }

  // Requête indexée : uniquement les neuvaines actives ayant un abonnement Push
  const candidates = await env.DB
    .prepare(
      'SELECT n.id AS novena_id, n.user_id, n.title AS novena_title, n.intention, n.total_days, n.start_date, ' +
      'n.completed_days_json, n.reminder_time, p.title AS prayer_title, ' +
      's.id AS sub_id, s.endpoint, s.p256dh, s.auth, s.tz_offset_minutes ' +
      'FROM novenas n ' +
      'INNER JOIN push_subscriptions s ON s.user_id = n.user_id ' +
      'LEFT JOIN prayers p ON p.user_id = n.user_id AND p.id = n.prayer_id AND p.deleted_at = 0 ' +
      'WHERE n.reminder_enabled = 1 AND n.deleted_at = 0'
    )
    .all();

  const due = [];
  for (const row of candidates.results || []) {
    const { localDate, localMinutes } = getLocalDateAndMinutes(nowUtc, row.tz_offset_minutes);
    const totalDays = Math.max(1, Number(row.total_days) || 9);
    const dayIdx = computeDayIndex(row.start_date, localDate);
    if (dayIdx < 1 || dayIdx > totalDays) continue;

    let completed = [];
    try { completed = JSON.parse(row.completed_days_json || '[]'); } catch { completed = []; }
    if (completed.includes(dayIdx)) continue;

    const [hh, mm] = String(row.reminder_time || '08:00').split(':');
    const remMinutes = (Number(hh) || 8) * 60 + (Number(mm) || 0);
    // Fenêtre généreuse de 45 min pour absorber sans perte tout débordement de lot > 40 sur le Cron suivant (5 min)
    if (localMinutes < remMinutes || localMinutes >= remMinutes + 45) continue;

    due.push({ ...row, localDate, dayIdx, totalDays });
  }

  if (due.length === 0) {
    return { ok: true, sent: 0, removed: 0, remainingDue: 0, subrequests: 0 };
  }

  // Filtrage des créneaux déjà envoyés aujourd'hui via push_sent_log
  const uniqueDates = [...new Set(due.map((d) => d.localDate))];
  const sentKeys = new Set();
  for (const dStr of uniqueDates) {
    const sentRows = await env.DB
      .prepare('SELECT sub_id, novena_id, local_date FROM push_sent_log WHERE local_date = ?')
      .bind(dStr)
      .all();
    for (const r of sentRows.results || []) {
      sentKeys.add(`${r.sub_id}|${r.novena_id}|${r.local_date}`);
    }
  }

  const pending = due.filter((d) => !sentKeys.has(`${d.sub_id}|${d.novena_id}|${d.localDate}`));
  const batchToSend = pending.slice(0, maxBatch);
  const remainingDue = Math.max(0, pending.length - batchToSend.length);

  const appUrl = env.APP_URL || 'https://josephdecacqueray.github.io/ma-priere-quotidienne/';
  let sent = 0;
  let removed = 0;
  let subrequests = 0;
  const dbWrites = [];

  for (const item of batchToSend) {
    const bodyParts = [`Jour ${item.dayIdx}/${item.totalDays}`];
    if (item.prayer_title) bodyParts.push(item.prayer_title);
    if (item.intention) bodyParts.push(item.intention);

    try {
      subrequests += 1;
      const res = await sendEncryptedPush(
        item,
        {
          title: `Prière : ${item.novena_title || 'Neuvaine'}`,
          body: bodyParts.join(' — ').slice(0, 220),
          url: appUrl,
          tag: `novena-${item.novena_id}-${item.localDate}`
        },
        env,
        fetchImpl
      );

      if (res.ok) {
        sent += 1;
        const notifKey = `${item.novena_id}:${item.localDate}`;
        dbWrites.push(
          env.DB
            .prepare('INSERT OR IGNORE INTO push_sent_log (sub_id, novena_id, local_date, sent_at) VALUES (?, ?, ?, ?)')
            .bind(item.sub_id, item.novena_id, item.localDate, nowUtc),
          env.DB
            .prepare('UPDATE push_subscriptions SET last_notified_key = ?, updated_at = ? WHERE id = ?')
            .bind(notifKey, nowUtc, item.sub_id)
        );
      } else if (res.status === 404 || res.status === 410) {
        removed += 1;
        dbWrites.push(env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(item.sub_id));
      }
    } catch {
      // Échec réseau isolé : sera retenté automatiquement au prochain tick dans 5 min
    }
  }

  if (dbWrites.length > 0) {
    await env.DB.batch(dbWrites);
  }

  return { ok: true, sent, removed, remainingDue, subrequests };
}
