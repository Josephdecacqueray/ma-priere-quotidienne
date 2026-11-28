/* =========================================================
   AUTHENTIFICATION DURCIE & SESSIONS PERSISTANTES (180 JOURS)
   - PBKDF2-SHA256 100 000 itérations
   - Anti-énumération (erreurs & temps homogénéisés)
   - Verrouillage progressif anti-brute-force + Turnstile
   - Refresh Token Reuse Detection (révocation totale de famille)
   - Gestion multi-appareils & clé de récupération 160 bits
   ========================================================= */

import {
  hashPassword,
  verifyPassword,
  dummyPasswordWork,
  generateRecoveryKey,
  normalizeRecoveryKey,
  sha256Hex,
  randomToken,
  signJwt,
  verifyJwt,
  timingSafeEqual
} from './crypto.js';
import {
  normalizeEmail,
  validatePasswordStrength,
  readJsonBounded,
  jsonResponse,
  hashClientIp,
  getClientIp,
  checkRateLimit,
  verifyTurnstile,
  sanitizeString
} from './security.js';

const ACCESS_TTL_SEC = 30 * 60; // 30 minutes
const REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 jours (connexion persistante PWA)

function makeId(prefix) {
  return `${prefix}_${randomToken(12)}`;
}

function getJwtSecret(env) {
  if (env.JWT_SIGNING_KEY && env.JWT_SIGNING_KEY.length >= 16) {
    return env.JWT_SIGNING_KEY;
  }
  if (env.ENVIRONMENT === 'development') {
    return 'local-dev-only-jwt-signing-key-never-use-in-prod-v8';
  }
  throw new Error('JWT_SECRET_MISSING');
}

async function createSessionPair(db, env, userId, deviceLabel, existingFamilyId = null) {
  const now = Date.now();
  const sessionId = makeId('ses');
  const familyId = existingFamilyId || makeId('fam');
  const refreshToken = randomToken(32);
  const refreshHash = await sha256Hex(refreshToken);
  const expiresAt = now + REFRESH_TTL_MS;
  const cleanDevice = sanitizeString(deviceLabel || 'Appareil', 80).trim() || 'Appareil';

  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, family_id, refresh_token_hash, device_label, created_at, last_seen_at, expires_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(sessionId, userId, familyId, refreshHash, cleanDevice, now, now, expiresAt)
    .run();

  const accessToken = await signJwt(
    { sub: userId, sid: sessionId, fid: familyId },
    getJwtSecret(env),
    ACCESS_TTL_SEC
  );

  return {
    sessionId,
    familyId,
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TTL_SEC,
    refreshExpiresAt: expiresAt
  };
}

export async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  let secret;
  try {
    secret = getJwtSecret(env);
  } catch {
    return null;
  }

  const payload = await verifyJwt(token, secret);
  if (!payload) return null;

  const now = Date.now();
  const session = await env.DB
    .prepare(
      'SELECT id, user_id, family_id FROM sessions ' +
      'WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?'
    )
    .bind(payload.sid, payload.sub, now)
    .first();

  if (!session) return null;
  return {
    userId: session.user_id,
    sessionId: session.id,
    familyId: session.family_id
  };
}

export async function handleRegister(request, env, origin) {
  const ipHash = await hashClientIp(request, env);
  const rl = await checkRateLimit(env.DB, `reg:${ipHash}`, 8, 3600);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'Trop de tentatives d’inscription. Réessayez plus tard.' },
      429,
      origin,
      { 'Retry-After': rl.retryAfterSec }
    );
  }

  const body = await readJsonBounded(request, 8192);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const deviceLabel = sanitizeString(body.deviceLabel || 'Appareil', 80);

  if (!email) {
    return jsonResponse({ error: 'Veuillez indiquer une adresse e-mail valide.' }, 400, origin);
  }

  const pwError = validatePasswordStrength(password, email);
  if (pwError) {
    return jsonResponse({ error: pwError }, 400, origin);
  }

  const tsOk = await verifyTurnstile(body.turnstileToken, getClientIp(request), env);
  if (!tsOk) {
    return jsonResponse({ error: 'Vérification anti-robot échouée. Réessayez.' }, 403, origin);
  }

  // Plafond strict anti-crash (1 000 comptes par défaut)
  const maxUsers = Math.max(1, Number(env.MAX_USERS) || 1000);
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
  if ((countRow?.total || 0) >= maxUsers) {
    return jsonResponse(
      {
        code: 'MAX_USERS_REACHED',
        error: 'Le nombre maximal de comptes gratuits (1 000) est actuellement atteint. L’application reste entièrement utilisable hors connexion en mode local.'
      },
      403,
      origin
    );
  }

  // Anti-énumération douce : message neutre si le compte existe déjà
  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE email_normalized = ?')
    .bind(email)
    .first();
  if (existing) {
    await dummyPasswordWork();
    return jsonResponse(
      {
        code: 'REGISTRATION_UNAVAILABLE',
        error: 'Impossible de créer ce compte avec ces informations. Si vous possédez déjà un compte, connectez-vous.'
      },
      409,
      origin
    );
  }

  const { salt, hash } = await hashPassword(password);
  const recoveryKey = generateRecoveryKey();
  const recoveryHash = await sha256Hex(normalizeRecoveryKey(recoveryKey));
  const userId = makeId('usr');
  const now = Date.now();
  const isOwner = Boolean(
    env.OWNER_MIGRATION_CODE &&
    body.ownerCode &&
    timingSafeEqual(String(body.ownerCode), String(env.OWNER_MIGRATION_CODE))
  );

  await env.DB
    .prepare(
      'INSERT INTO users (id, email_normalized, password_hash, password_salt, recovery_key_hash, role, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(userId, email, hash, salt, recoveryHash, isOwner ? 'owner' : 'user', now, now)
    .run();

  const tokens = await createSessionPair(env.DB, env, userId, deviceLabel);

  return jsonResponse(
    {
      ok: true,
      user: { id: userId, email, role: isOwner ? 'owner' : 'user' },
      recoveryKey,
      ...tokens
    },
    201,
    origin
  );
}

export async function handleLogin(request, env, origin) {
  const ipHash = await hashClientIp(request, env);
  const rl = await checkRateLimit(env.DB, `login:${ipHash}`, 20, 900);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'Trop de tentatives de connexion. Patientez quelques minutes.' },
      429,
      origin,
      { 'Retry-After': rl.retryAfterSec }
    );
  }

  const body = await readJsonBounded(request, 8192);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const deviceLabel = sanitizeString(body.deviceLabel || 'Appareil', 80);

  if (!email || !password) {
    return jsonResponse({ error: 'Identifiants invalides.' }, 401, origin);
  }

  const user = await env.DB
    .prepare(
      'SELECT id, email_normalized, password_hash, password_salt, role, failed_login_count, locked_until ' +
      'FROM users WHERE email_normalized = ?'
    )
    .bind(email)
    .first();

  const now = Date.now();

  if (!user) {
    // Coût cryptographique homogénéisé anti-énumération
    await dummyPasswordWork();
    return jsonResponse({ error: 'Identifiants invalides.' }, 401, origin);
  }

  if (user.locked_until && user.locked_until > now) {
    const retryAfterSec = Math.ceil((user.locked_until - now) / 1000);
    await dummyPasswordWork();
    return jsonResponse(
      {
        code: 'ACCOUNT_LOCKED',
        error: 'Compte temporairement protégé après plusieurs tentatives infructueuses. Réessayez dans quelques minutes.',
        retryAfterSec
      },
      429,
      origin,
      { 'Retry-After': retryAfterSec }
    );
  }

  // Turnstile exigé après 3 échecs consécutifs
  if (user.failed_login_count >= 3 && env.TURNSTILE_SECRET_KEY) {
    const tsOk = await verifyTurnstile(body.turnstileToken, getClientIp(request), env);
    if (!tsOk) {
      return jsonResponse(
        {
          code: 'TURNSTILE_REQUIRED',
          error: 'Vérification anti-robot requise pour continuer.'
        },
        403,
        origin
      );
    }
  }

  const valid = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!valid) {
    const nextFails = (user.failed_login_count || 0) + 1;
    let lockDurationMs = 0;
    if (nextFails >= 10) lockDurationMs = 60 * 60 * 1000;
    else if (nextFails >= 7) lockDurationMs = 15 * 60 * 1000;
    else if (nextFails >= 5) lockDurationMs = 2 * 60 * 1000;

    await env.DB
      .prepare('UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .bind(nextFails, lockDurationMs > 0 ? now + lockDurationMs : 0, now, user.id)
      .run();

    return jsonResponse({ error: 'Identifiants invalides.' }, 401, origin);
  }

  if (user.failed_login_count > 0 || user.locked_until > 0) {
    await env.DB
      .prepare('UPDATE users SET failed_login_count = 0, locked_until = 0, updated_at = ? WHERE id = ?')
      .bind(now, user.id)
      .run();
  }

  const tokens = await createSessionPair(env.DB, env, user.id, deviceLabel);
  return jsonResponse(
    {
      ok: true,
      user: { id: user.id, email: user.email_normalized, role: user.role },
      ...tokens
    },
    200,
    origin
  );
}

export async function handleRefresh(request, env, origin) {
  const ipHash = await hashClientIp(request, env);
  const rl = await checkRateLimit(env.DB, `refresh:${ipHash}`, 60, 900);
  if (!rl.allowed) {
    return jsonResponse({ error: 'Trop de requêtes.' }, 429, origin, { 'Retry-After': rl.retryAfterSec });
  }

  const body = await readJsonBounded(request, 4096);
  const refreshToken = String(body.refreshToken || '').trim();
  const deviceLabel = sanitizeString(body.deviceLabel || '', 80);

  if (!refreshToken || refreshToken.length < 20) {
    return jsonResponse({ code: 'TOKEN_REVOKED', error: 'Jeton de session invalide.' }, 401, origin);
  }

  const tokenHash = await sha256Hex(refreshToken);
  const session = await env.DB
    .prepare(
      'SELECT id, user_id, family_id, device_label, expires_at, rotated_at, revoked_at ' +
      'FROM sessions WHERE refresh_token_hash = ?'
    )
    .bind(tokenHash)
    .first();

  if (!session) {
    return jsonResponse({ code: 'TOKEN_REVOKED', error: 'Session expirée ou invalide.' }, 401, origin);
  }

  const now = Date.now();

  // DÉTECTION DE REJEU / VOL DE REFRESH TOKEN :
  // Si un jeton déjà tourné ou révoqué est représenté, on révoque TOUTE la famille de session immédiatement.
  if (session.rotated_at || session.revoked_at) {
    await env.DB
      .prepare('UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
      .bind(now, session.family_id)
      .run();
    return jsonResponse(
      {
        code: 'TOKEN_REVOKED',
        error: 'Activité suspecte détectée (jeton déjà utilisé). La session a été fermée par sécurité.'
      },
      401,
      origin
    );
  }

  if (session.expires_at <= now) {
    await env.DB
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
      .bind(now, session.id)
      .run();
    return jsonResponse({ code: 'TOKEN_REVOKED', error: 'Session expirée.' }, 401, origin);
  }

  // Rotation atomique : l'ancien jeton est consommé (gardé en trace pour détecter tout rejeu)
  await env.DB
    .prepare('UPDATE sessions SET rotated_at = ?, revoked_at = ?, last_seen_at = ? WHERE id = ?')
    .bind(now, now, now, session.id)
    .run();

  const tokens = await createSessionPair(
    env.DB,
    env,
    session.user_id,
    deviceLabel || session.device_label,
    session.family_id
  );

  const user = await env.DB
    .prepare('SELECT id, email_normalized, role FROM users WHERE id = ?')
    .bind(session.user_id)
    .first();

  return jsonResponse(
    {
      ok: true,
      user: user ? { id: user.id, email: user.email_normalized, role: user.role } : null,
      ...tokens
    },
    200,
    origin
  );
}

export async function handleRecover(request, env, origin) {
  const ipHash = await hashClientIp(request, env);
  const rl = await checkRateLimit(env.DB, `recover:${ipHash}`, 5, 3600);
  if (!rl.allowed) {
    return jsonResponse({ error: 'Trop de tentatives. Réessayez plus tard.' }, 429, origin, { 'Retry-After': rl.retryAfterSec });
  }

  const body = await readJsonBounded(request, 8192);
  const email = normalizeEmail(body.email);
  const recoveryKeyRaw = normalizeRecoveryKey(body.recoveryKey);
  const newPassword = String(body.newPassword || '');
  const deviceLabel = sanitizeString(body.deviceLabel || 'Appareil', 80);

  const tsOk = await verifyTurnstile(body.turnstileToken, getClientIp(request), env);
  if (!tsOk) {
    return jsonResponse({ error: 'Vérification anti-robot échouée.' }, 403, origin);
  }

  if (!email || recoveryKeyRaw.length < 16) {
    await dummyPasswordWork();
    return jsonResponse({ error: 'Impossible de réinitialiser le mot de passe avec ces informations.' }, 400, origin);
  }

  const pwErr = validatePasswordStrength(newPassword, email);
  if (pwErr) {
    return jsonResponse({ error: pwErr }, 400, origin);
  }

  const user = await env.DB
    .prepare('SELECT id, email_normalized, recovery_key_hash, role FROM users WHERE email_normalized = ?')
    .bind(email)
    .first();

  const providedHash = await sha256Hex(recoveryKeyRaw);
  if (!user || !timingSafeEqual(providedHash, user.recovery_key_hash)) {
    await dummyPasswordWork();
    return jsonResponse({ error: 'Impossible de réinitialiser le mot de passe avec ces informations.' }, 400, origin);
  }

  const { salt, hash } = await hashPassword(newPassword);
  const nextRecoveryKey = generateRecoveryKey();
  const nextRecoveryHash = await sha256Hex(normalizeRecoveryKey(nextRecoveryKey));
  const now = Date.now();

  // Changement de mot de passe + révocation immédiate de TOUTES les sessions existantes
  await env.DB.batch([
    env.DB
      .prepare(
        'UPDATE users SET password_hash = ?, password_salt = ?, recovery_key_hash = ?, ' +
        'failed_login_count = 0, locked_until = 0, updated_at = ? WHERE id = ?'
      )
      .bind(hash, salt, nextRecoveryHash, now, user.id),
    env.DB
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, user.id)
  ]);

  const tokens = await createSessionPair(env.DB, env, user.id, deviceLabel);
  return jsonResponse(
    {
      ok: true,
      user: { id: user.id, email: user.email_normalized, role: user.role },
      recoveryKey: nextRecoveryKey,
      ...tokens
    },
    200,
    origin
  );
}

export async function handleChangePassword(request, env, origin, auth) {
  const body = await readJsonBounded(request, 8192);
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');

  const user = await env.DB
    .prepare('SELECT id, email_normalized, password_hash, password_salt FROM users WHERE id = ?')
    .bind(auth.userId)
    .first();
  if (!user) {
    return jsonResponse({ error: 'Compte introuvable.' }, 404, origin);
  }

  const ok = await verifyPassword(currentPassword, user.password_salt, user.password_hash);
  if (!ok) {
    return jsonResponse({ error: 'Mot de passe actuel incorrect.' }, 401, origin);
  }

  const pwErr = validatePasswordStrength(newPassword, user.email_normalized);
  if (pwErr) {
    return jsonResponse({ error: pwErr }, 400, origin);
  }

  const { salt, hash } = await hashPassword(newPassword);
  const now = Date.now();
  await env.DB.batch([
    env.DB
      .prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
      .bind(hash, salt, now, auth.userId),
    env.DB
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, auth.userId)
  ]);

  const tokens = await createSessionPair(env.DB, env, auth.userId, body.deviceLabel || 'Cet appareil');
  return jsonResponse({ ok: true, ...tokens }, 200, origin);
}

export async function handleListSessions(request, env, origin, auth) {
  const now = Date.now();
  const rows = await env.DB
    .prepare(
      'SELECT id, device_label, created_at, last_seen_at, expires_at FROM sessions ' +
      'WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC'
    )
    .bind(auth.userId, now)
    .all();

  const sessions = (rows.results || []).map((r) => ({
    id: r.id,
    deviceLabel: r.device_label,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    isCurrent: r.id === auth.sessionId
  }));

  const user = await env.DB
    .prepare('SELECT id, email_normalized, role, text_bytes_used, created_at FROM users WHERE id = ?')
    .bind(auth.userId)
    .first();

  return jsonResponse(
    {
      ok: true,
      user: user
        ? {
            id: user.id,
            email: user.email_normalized,
            role: user.role,
            textBytesUsed: user.text_bytes_used || 0,
            maxTextBytes: Number(env.MAX_USER_TEXT_BYTES) || 2097152,
            createdAt: user.created_at
          }
        : null,
      sessions
    },
    200,
    origin
  );
}

export async function handleRevokeSession(request, env, origin, auth, targetSessionId) {
  const now = Date.now();
  // Isolation stricte : WHERE id = ? AND user_id = ? (anti-IDOR)
  const target = await env.DB
    .prepare('SELECT id, family_id FROM sessions WHERE id = ? AND user_id = ?')
    .bind(targetSessionId, auth.userId)
    .first();

  if (!target) {
    return jsonResponse({ error: 'Session introuvable.' }, 404, origin);
  }

  await env.DB
    .prepare('UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(now, target.family_id, auth.userId)
    .run();

  return jsonResponse({ ok: true }, 200, origin);
}

export async function handleLogout(request, env, origin) {
  const now = Date.now();
  const auth = await requireAuth(request, env);
  if (auth) {
    await env.DB
      .prepare('UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND user_id = ? AND revoked_at IS NULL')
      .bind(now, auth.familyId, auth.userId)
      .run();
    return jsonResponse({ ok: true }, 200, origin);
  }

  try {
    const body = await readJsonBounded(request, 4096);
    if (body.refreshToken) {
      const h = await sha256Hex(String(body.refreshToken));
      const row = await env.DB
        .prepare('SELECT family_id FROM sessions WHERE refresh_token_hash = ?')
        .bind(h)
        .first();
      if (row) {
        await env.DB
          .prepare('UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
          .bind(now, row.family_id)
          .run();
      }
    }
  } catch {
    // Ignoré
  }
  return jsonResponse({ ok: true }, 200, origin);
}

/**
 * Droit à l'effacement (RGPD) : suppression définitive du compte et de toutes les données associées.
 * Exige authentification + vérification du mot de passe actuel.
 */
export async function handleDeleteAccount(request, env, origin, auth) {
  const body = await readJsonBounded(request, 4096);
  const password = String(body.password || '');
  if (!password) {
    return jsonResponse({ error: 'Saisissez votre mot de passe actuel pour confirmer la suppression.' }, 400, origin);
  }

  const user = await env.DB
    .prepare('SELECT id, password_hash, password_salt FROM users WHERE id = ?')
    .bind(auth.userId)
    .first();
  if (!user) {
    return jsonResponse({ error: 'Compte introuvable.' }, 404, origin);
  }

  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) {
    return jsonResponse({ error: 'Mot de passe incorrect.' }, 401, origin);
  }

  // Nettoyage explicite de toutes les tables liées (en plus des FK ON DELETE CASCADE)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM prayers WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM novenas WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM intentions WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM rosary_state WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM settings WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('UPDATE feedback_messages SET user_id = NULL WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(auth.userId)
  ]);

  return jsonResponse({ ok: true }, 200, origin);
}

function generateSixDigitCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, '0');
}

async function sendResetEmailViaRelay(env, toEmail, code, fetchImpl = fetch) {
  const relayKey = String(env.EMAIL_RELAY_KEY || '').trim();
  const provider = String(env.EMAIL_RELAY_PROVIDER || 'resend').trim().toLowerCase();
  if (!relayKey) return false;

  const subject = 'Code de réinitialisation — Ma prière quotidienne';
  const textBody = [
    'Bonjour,',
    '',
    'Voici votre code temporaire pour réinitialiser le mot de passe de votre compte Ma prière quotidienne :',
    '',
    `    ${code}`,
    '',
    'Ce code est valable 15 minutes et ne peut être utilisé qu’une seule fois.',
    'Si vous n’êtes pas à l’origine de cette demande, vous pouvez simplement ignorer cet e-mail.'
  ].join('\n');

  if (provider === 'resend') {
    const resp = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${relayKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'Ma priere quotidienne <onboarding@resend.dev>',
        to: [toEmail],
        subject,
        text: textBody
      })
    });
    return resp.ok;
  }

  if (provider === 'brevo') {
    const fromRaw = String(env.EMAIL_FROM || '').trim();
    const match = fromRaw.match(/^(.*?)<([^>]+)>$/);
    const senderEmail = (match ? match[2] : fromRaw || env.CONTACT_TARGET_EMAIL || '').trim();
    const senderName = (match ? match[1] : 'Ma prière quotidienne').trim() || 'Ma prière quotidienne';
    if (!senderEmail) return false;
    const resp = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': relayKey,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: toEmail }],
        subject,
        textContent: textBody
      })
    });
    return resp.ok;
  }

  return false;
}

export async function handleForgotEmail(request, env, origin, fetchImpl = fetch) {
  const ipHash = await hashClientIp(request, env);
  const rl = await checkRateLimit(env.DB, `fge:${ipHash}`, 5, 3600);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'Trop de demandes récentes. Merci de patienter une heure.' },
      429,
      origin,
      { 'Retry-After': rl.retryAfterSec }
    );
  }

  const body = await readJsonBounded(request, 8192);
  const tsOk = await verifyTurnstile(body.turnstileToken, getClientIp(request), env, fetchImpl);
  if (!tsOk) {
    return jsonResponse({ error: 'Vérification anti-robot échouée.' }, 403, origin);
  }

  const email = normalizeEmail(body.email);
  const genericOk = {
    ok: true,
    message: 'Si un compte correspond à cette adresse, un code à 6 chiffres vient d’être envoyé (valable 15 minutes).'
  };
  if (!email) {
    return jsonResponse(genericOk, 200, origin);
  }

  const user = await env.DB
    .prepare('SELECT id, email_normalized FROM users WHERE email_normalized = ?')
    .bind(email)
    .first();

  if (!user) {
    await dummyPasswordWork();
    return jsonResponse(genericOk, 200, origin);
  }

  const code = generateSixDigitCode();
  const codeHash = await sha256Hex(`${user.id}:${code}`);
  const now = Date.now();
  const expiresAt = now + 15 * 60 * 1000;

  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').bind(user.id),
    env.DB
      .prepare('INSERT INTO password_reset_codes (id, user_id, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .bind(makeId('rst'), user.id, codeHash, expiresAt, now)
  ]);

  await sendResetEmailViaRelay(env, user.email_normalized, code, fetchImpl).catch(() => false);
  return jsonResponse(genericOk, 200, origin);
}

export async function handleResetEmail(request, env, origin) {
  const ipHash = await hashClientIp(request, env);
  const rl = await checkRateLimit(env.DB, `rse:${ipHash}`, 10, 3600);
  if (!rl.allowed) {
    return jsonResponse({ error: 'Trop de tentatives. Patientez avant de réessayer.' }, 429, origin);
  }

  const body = await readJsonBounded(request, 8192);
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').replace(/\s+/g, '');
  const newPassword = String(body.newPassword || '');
  const deviceLabel = sanitizeString(body.deviceLabel || 'Appareil', 80);

  if (!email || !/^\d{6}$/.test(code)) {
    return jsonResponse({ error: 'Saisissez votre adresse e-mail et le code à 6 chiffres.' }, 400, origin);
  }

  const pwErr = validatePasswordStrength(newPassword, email);
  if (pwErr) {
    return jsonResponse({ error: pwErr }, 400, origin);
  }

  const user = await env.DB
    .prepare('SELECT id, email_normalized, role FROM users WHERE email_normalized = ?')
    .bind(email)
    .first();

  const now = Date.now();
  const row = user
    ? await env.DB
        .prepare('SELECT id, code_hash, attempts, expires_at, used_at FROM password_reset_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
        .bind(user.id)
        .first()
    : null;

  if (!user || !row || row.used_at || row.expires_at < now || row.attempts >= 5) {
    await dummyPasswordWork();
    return jsonResponse({ error: 'Code invalide ou expiré. Demandez un nouveau code.' }, 400, origin);
  }

  const expectedHash = await sha256Hex(`${user.id}:${code}`);
  if (!timingSafeEqual(expectedHash, row.code_hash)) {
    await env.DB.prepare('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return jsonResponse({ error: 'Code incorrect.' }, 400, origin);
  }

  const { salt, hash } = await hashPassword(newPassword);
  const nextRecoveryKey = generateRecoveryKey();
  const nextRecoveryHash = await sha256Hex(normalizeRecoveryKey(nextRecoveryKey));

  await env.DB.batch([
    env.DB
      .prepare('UPDATE password_reset_codes SET used_at = ? WHERE id = ?')
      .bind(now, row.id),
    env.DB
      .prepare('UPDATE users SET password_hash = ?, password_salt = ?, recovery_key_hash = ?, failed_login_count = 0, locked_until = 0, updated_at = ? WHERE id = ?')
      .bind(hash, salt, nextRecoveryHash, now, user.id),
    env.DB
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, user.id)
  ]);

  const tokens = await createSessionPair(env.DB, env, user.id, deviceLabel);
  return jsonResponse(
    {
      ok: true,
      user: { id: user.id, email: user.email_normalized, role: user.role },
      recoveryKey: nextRecoveryKey,
      ...tokens
    },
    200,
    origin
  );
}
