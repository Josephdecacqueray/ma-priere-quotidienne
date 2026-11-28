/* =========================================================
   CONTACT BUG & SUGGESTION (REDIRECTION PRIVÉE SANS EXPOSER L'E-MAIL)
   - Adresse cible lue EXCLUSIVEMENT depuis le Secret env.CONTACT_TARGET_EMAIL
   - Archive garantie dans D1 (feedback_messages) avant envoi e-mail
   - Adaptateur relais gratuit sans CB : Resend / Web3Forms / Webhook
   - Anti-spam : honeypot + temps minimal + Turnstile + rate-limit 3/heure
   ========================================================= */

import { randomToken } from './crypto.js';
import {
  readJsonBounded,
  jsonResponse,
  hashClientIp,
  getClientIp,
  checkRateLimit,
  verifyTurnstile,
  sanitizeString
} from './security.js';
import { requireAuth } from './auth.js';

const ALLOWED_CATEGORIES = new Set(['bug', 'suggestion', 'other']);
const CATEGORY_LABELS = {
  bug: 'Signalement de bug',
  suggestion: 'Suggestion d’amélioration',
  other: 'Autre question'
};

function sanitizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const safe = {
    appVersion: sanitizeString(ctx.appVersion || '', 24),
    viewport: sanitizeString(ctx.viewport || '', 32),
    standalone: Boolean(ctx.standalone),
    online: Boolean(ctx.online),
    platform: sanitizeString(ctx.platform || '', 60),
    userAgent: sanitizeString(ctx.userAgent || '', 220)
  };
  return JSON.stringify(safe);
}

export async function forwardFeedbackEmail(env, record, fetchImpl = fetch) {
  const targetEmail = String(env.CONTACT_TARGET_EMAIL || '').trim();
  const relayKey = String(env.EMAIL_RELAY_KEY || '').trim();
  const provider = String(env.EMAIL_RELAY_PROVIDER || 'resend').trim().toLowerCase();

  if (!targetEmail || !relayKey) {
    return { forwarded: false, status: 'stored_only' };
  }

  const subject = `[Ma prière quotidienne] ${CATEGORY_LABELS[record.category] || 'Contact'} (#${record.id.slice(-6)})`;
  const lines = [
    `Catégorie : ${CATEGORY_LABELS[record.category] || record.category}`,
    `Référence : ${record.id}`,
    `Date (UTC) : ${new Date(record.createdAt).toISOString()}`,
    record.replyContact ? `Contact expéditeur : ${record.replyContact}` : 'Contact expéditeur : (non renseigné)',
    '',
    '--- Message ---',
    record.message
  ];
  if (record.appContext) {
    lines.push('', '--- Contexte technique (opt-in) ---', record.appContext);
  }
  const bodyText = lines.join('\n');

  try {
    if (provider === 'resend') {
      const resp = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${relayKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM || 'Ma priere quotidienne <onboarding@resend.dev>',
          to: [targetEmail],
          subject,
          text: bodyText
        })
      });
      return { forwarded: resp.ok, status: resp.ok ? 'sent' : 'relay_error' };
    }

    if (provider === 'web3forms') {
      const resp = await fetchImpl('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: relayKey,
          subject,
          from_name: 'Ma prière quotidienne',
          message: bodyText
        })
      });
      return { forwarded: resp.ok, status: resp.ok ? 'sent' : 'relay_error' };
    }

    if (provider === 'webhook' && env.EMAIL_RELAY_WEBHOOK_URL) {
      const resp = await fetchImpl(env.EMAIL_RELAY_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${relayKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: targetEmail,
          subject,
          text: bodyText,
          category: record.category,
          id: record.id
        })
      });
      return { forwarded: resp.ok, status: resp.ok ? 'sent' : 'relay_error' };
    }

    return { forwarded: false, status: 'stored_only' };
  } catch {
    return { forwarded: false, status: 'relay_error' };
  }
}

export async function handleFeedback(request, env, origin, fetchImpl = fetch) {
  const ipHash = await hashClientIp(request, env);
  // Anti-spam strict : 3 messages max par heure par IP
  const rl = await checkRateLimit(env.DB, `fb:${ipHash}`, 3, 3600);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'Vous avez déjà envoyé plusieurs messages récemment. Merci de réessayer dans une heure.' },
      429,
      origin,
      { 'Retry-After': rl.retryAfterSec }
    );
  }

  const body = await readJsonBounded(request, 16384);

  // 1. Piège honeypot invisible (un humain ne le remplit jamais)
  if (String(body.website || '').trim() !== '' || String(body.hp || '').trim() !== '') {
    return jsonResponse({ error: 'Requête rejetée par le filtre anti-spam.' }, 400, origin);
  }

  // 2. Délai minimal de saisie (empêche les soumissions robotisées instantanées)
  const elapsedMs = Number(body.elapsedMs);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1500) {
    return jsonResponse({ error: 'Merci de prendre un instant pour rédiger votre message avant l’envoi.' }, 400, origin);
  }

  // 3. Vérification Turnstile
  const tsOk = await verifyTurnstile(body.turnstileToken, getClientIp(request), env, fetchImpl);
  if (!tsOk) {
    return jsonResponse({ error: 'Vérification anti-spam échouée. Réessayez.' }, 403, origin);
  }

  // 4. Validation stricte des champs
  const category = ALLOWED_CATEGORIES.has(body.category) ? body.category : null;
  if (!category) {
    return jsonResponse({ error: 'Catégorie de message invalide.' }, 400, origin);
  }

  const message = sanitizeString(body.message || '', 3000).trim();
  if (message.length < 10) {
    return jsonResponse({ error: 'Merci de détailler votre message (au moins 10 caractères).' }, 400, origin);
  }

  const replyContact = sanitizeString(body.replyContact || '', 180).trim();
  const appContext = body.includeContext ? sanitizeContext(body.appContext) : '';
  const auth = await requireAuth(request, env);
  const id = `fb_${randomToken(10)}`;
  const now = Date.now();

  // 5. Archive de secours dans D1 AVANT la redirection e-mail (zéro perte)
  await env.DB
    .prepare(
      'INSERT INTO feedback_messages (id, user_id, category, message, reply_contact, app_context, ip_hash, status, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, auth?.userId || null, category, message, replyContact, appContext, ipHash, 'received', now)
    .run();

  // 6. Redirection e-mail vers env.CONTACT_TARGET_EMAIL (jamais exposée au client)
  const relayRes = await forwardFeedbackEmail(
    env,
    { id, category, message, replyContact, appContext, createdAt: now },
    fetchImpl
  );

  await env.DB
    .prepare('UPDATE feedback_messages SET status = ? WHERE id = ?')
    .bind(relayRes.status, id)
    .run();

  return jsonResponse(
    {
      ok: true,
      id,
      message: 'Merci ! Votre message a bien été transmis.'
    },
    201,
    origin
  );
}
