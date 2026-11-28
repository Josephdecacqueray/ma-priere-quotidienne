/* =========================================================
   POINT D'ENTRÉE CLOUDFLARE WORKER (ma-priere-api v8)
   - CORS strict liste blanche (jamais *)
   - En-têtes sécurité OWASP sur toutes les réponses
   - Aucun log de secret, mot de passe, token ou adresse privée
   ========================================================= */

import { getAllowedOrigin, buildSecurityHeaders, jsonResponse } from './security.js';
import {
  requireAuth,
  handleRegister,
  handleLogin,
  handleRefresh,
  handleRecover,
  handleChangePassword,
  handleListSessions,
  handleRevokeSession,
  handleLogout
} from './auth.js';
import { handleGetSync, handlePostSync } from './sync.js';
import {
  handlePushSubscribe,
  handlePushUnsubscribe,
  handlePushTest,
  runDueRemindersCron
} from './webpush.js';
import { handleFeedback } from './feedback.js';

export default {
  async fetch(request, env) {
    const allowedOrigin = getAllowedOrigin(request, env);
    const reqOrigin = request.headers.get('Origin');

    // Rejet strict CORS si une origine tierce non autorisée tente un appel navigateur
    if (reqOrigin && !allowedOrigin) {
      return jsonResponse({ error: 'Origine non autorisée.' }, 403, null);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: buildSecurityHeaders(allowedOrigin) });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    try {
      // Santé & configuration publique non sensible
      if (method === 'GET' && pathname === '/health') {
        return jsonResponse({ ok: true, version: '8.0.0' }, 200, allowedOrigin);
      }

      if (method === 'GET' && pathname === '/api/config') {
        return jsonResponse(
          {
            ok: true,
            version: '8.0.0',
            maxUsers: Number(env.MAX_USERS) || 1000,
            maxTextBytes: Number(env.MAX_USER_TEXT_BYTES) || 2097152,
            vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
            turnstileSiteKey: env.TURNSTILE_SITE_KEY || ''
          },
          200,
          allowedOrigin
        );
      }

      // Authentification & sessions persistantes
      if (method === 'POST' && pathname === '/api/auth/register') {
        return await handleRegister(request, env, allowedOrigin);
      }
      if (method === 'POST' && pathname === '/api/auth/login') {
        return await handleLogin(request, env, allowedOrigin);
      }
      if (method === 'POST' && pathname === '/api/auth/refresh') {
        return await handleRefresh(request, env, allowedOrigin);
      }
      if (method === 'POST' && pathname === '/api/auth/recover') {
        return await handleRecover(request, env, allowedOrigin);
      }
      if (method === 'POST' && pathname === '/api/auth/logout') {
        return await handleLogout(request, env, allowedOrigin);
      }

      // Contact bug & suggestion (ouvert avec anti-spam strict)
      if (method === 'POST' && pathname === '/api/feedback') {
        return await handleFeedback(request, env, allowedOrigin);
      }

      // Clé publique VAPID
      if (method === 'GET' && pathname === '/api/push/vapid-public-key') {
        return jsonResponse({ publicKey: env.VAPID_PUBLIC_KEY || '' }, 200, allowedOrigin);
      }

      // Routes protégées : exigent un JWT HS256 valide + session active non révoquée
      const auth = await requireAuth(request, env);
      if (!auth) {
        return jsonResponse({ code: 'UNAUTHORIZED', error: 'Authentification requise.' }, 401, allowedOrigin);
      }

      if (method === 'GET' && pathname === '/api/auth/sessions') {
        return await handleListSessions(request, env, allowedOrigin, auth);
      }
      if (method === 'POST' && pathname === '/api/auth/change-password') {
        return await handleChangePassword(request, env, allowedOrigin, auth);
      }
      const sesMatch = pathname.match(/^\/api\/auth\/sessions\/([a-zA-Z0-9_-]{4,80})$/);
      if (method === 'DELETE' && sesMatch) {
        return await handleRevokeSession(request, env, allowedOrigin, auth, sesMatch[1]);
      }

      // Synchronisation texte & métadonnées cloisonnée par user_id
      if (method === 'GET' && pathname === '/api/sync') {
        return await handleGetSync(request, env, allowedOrigin, auth);
      }
      if (method === 'POST' && pathname === '/api/sync') {
        return await handlePostSync(request, env, allowedOrigin, auth);
      }

      // Notifications Web Push scopées au compte connecté
      if (method === 'POST' && pathname === '/api/push/subscribe') {
        return await handlePushSubscribe(request, env, allowedOrigin, auth);
      }
      if (method === 'POST' && pathname === '/api/push/unsubscribe') {
        return await handlePushUnsubscribe(request, env, allowedOrigin, auth);
      }
      if (method === 'POST' && pathname === '/api/push/test') {
        return await handlePushTest(request, env, allowedOrigin, auth);
      }

      // Route de déclenchement manuel du Cron uniquement en développement local pour les tests automatisés
      if (env.ENVIRONMENT === 'development' && method === 'POST' && pathname === '/api/dev/run-cron') {
        const result = await runDueRemindersCron(env);
        return jsonResponse(result, 200, allowedOrigin);
      }

      return jsonResponse({ error: 'Route introuvable.' }, 404, allowedOrigin);
    } catch (err) {
      if (err?.status === 413 || err?.message === 'PAYLOAD_TOO_LARGE') {
        return jsonResponse({ error: 'Requête trop volumineuse.' }, 413, allowedOrigin);
      }
      if (err?.status === 400 || err?.message === 'INVALID_JSON') {
        return jsonResponse({ error: 'Format de données invalide.' }, 400, allowedOrigin);
      }
      // Journalisation minimale sans aucune donnée personnelle ni secret
      console.error('Worker unhandled error:', err?.message || 'INTERNAL');
      return jsonResponse({ error: 'Erreur interne temporaire.' }, 500, allowedOrigin);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runDueRemindersCron(env));
  }
};
