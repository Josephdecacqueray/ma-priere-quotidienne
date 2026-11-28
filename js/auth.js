/* =========================================================
   AUTHENTIFICATION & SESSION PERSISTANTE (180 JOURS, iOS PWA)
   - Session persistée en IndexedDB + miroir localStorage
   - Rotation silencieuse du refresh token avec verrou anti-concurrence
   - RÈGLE D'OR HORS-LIGNE : ne déconnecte JAMAIS en mode avion,
     sur erreur réseau, 429 ou 5xx. Seule une déconnexion explicite
     ou une révocation serveur explicite (401 TOKEN_REVOKED) ferme la session.
   ========================================================= */

import { getMeta, setMeta, clearUserStoresLocal } from './db.js';
import { getApiBaseUrl } from './config.js';

const AUTH_META_KEY = 'auth_session_v8';
const AUTH_LS_MIRROR_KEY = 'mpq_auth_session_v8';
const LAST_OWNER_KEY = 'last_owner_user_id';
const ACCESS_REFRESH_MARGIN_MS = 3 * 60 * 1000; // Rafraîchit 3 min avant expiration

let currentSession = null;
let activeRefreshPromise = null;
const listeners = new Set();

function notifyListeners() {
  const snapshot = getAuthState();
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      // Ne jamais casser la chaîne de notification
    }
  }
}

export function onAuthChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function detectDeviceLabel() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const standalone = typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator?.standalone === true
  );
  let device = 'Navigateur';
  if (/iPhone/i.test(ua)) device = standalone ? 'iPhone (App)' : 'iPhone (Safari)';
  else if (/iPad/i.test(ua)) device = standalone ? 'iPad (App)' : 'iPad (Safari)';
  else if (/Android/i.test(ua)) device = standalone ? 'Android (App)' : 'Android';
  else if (/Mac OS X/i.test(ua)) device = 'Mac';
  else if (/Windows/i.test(ua)) device = 'Windows';
  else if (/Linux/i.test(ua)) device = 'Linux';
  return device;
}

async function persistSession(session) {
  currentSession = session || null;
  try {
    await setMeta(AUTH_META_KEY, currentSession);
  } catch {
    // IndexedDB peut être momentanément occupé
  }
  try {
    if (currentSession) {
      localStorage.setItem(AUTH_LS_MIRROR_KEY, JSON.stringify(currentSession));
    } else {
      localStorage.removeItem(AUTH_LS_MIRROR_KEY);
    }
  } catch {
    // Stockage local indisponible
  }
  notifyListeners();
}

function normalizeStoredSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.user?.id || !raw.refreshToken) return null;
  return {
    user: {
      id: String(raw.user.id),
      email: String(raw.user.email || ''),
      role: String(raw.user.role || 'user')
    },
    sessionId: String(raw.sessionId || ''),
    accessToken: String(raw.accessToken || ''),
    accessExpiresAt: Number(raw.accessExpiresAt) || 0,
    refreshToken: String(raw.refreshToken),
    refreshExpiresAt: Number(raw.refreshExpiresAt) || 0,
    deviceLabel: String(raw.deviceLabel || detectDeviceLabel())
  };
}

export async function initAuth() {
  let stored = null;
  try {
    stored = normalizeStoredSession(await getMeta(AUTH_META_KEY));
  } catch {
    stored = null;
  }

  if (!stored) {
    try {
      const mirror = JSON.parse(localStorage.getItem(AUTH_LS_MIRROR_KEY) || 'null');
      stored = normalizeStoredSession(mirror);
      if (stored) {
        // Ré-hydrate IndexedDB silencieusement
        await setMeta(AUTH_META_KEY, stored).catch(() => {});
      }
    } catch {
      stored = null;
    }
  }

  currentSession = stored;
  notifyListeners();

  // Si en ligne et jeton d'accès expiré, rafraîchissement discret en arrière-plan
  if (currentSession && navigator.onLine && getApiBaseUrl()) {
    if (!currentSession.accessToken || currentSession.accessExpiresAt - Date.now() < ACCESS_REFRESH_MARGIN_MS) {
      refreshAccessToken().catch(() => {});
    }
  }
  return getAuthState();
}

export function getAuthState() {
  return {
    signedIn: Boolean(currentSession?.user?.id && currentSession?.refreshToken),
    user: currentSession?.user ? { ...currentSession.user } : null,
    sessionId: currentSession?.sessionId || '',
    refreshExpiresAt: currentSession?.refreshExpiresAt || 0,
    apiConfigured: Boolean(getApiBaseUrl())
  };
}

export function isSignedIn() {
  return Boolean(currentSession?.user?.id && currentSession?.refreshToken);
}

function buildSessionFromAuthPayload(data, fallbackUser = null) {
  const user = data.user || fallbackUser;
  const now = Date.now();
  return normalizeStoredSession({
    user,
    sessionId: data.sessionId || currentSession?.sessionId || '',
    accessToken: data.accessToken,
    accessExpiresAt: now + (Number(data.expiresIn) || 1800) * 1000,
    refreshToken: data.refreshToken,
    refreshExpiresAt: Number(data.refreshExpiresAt) || now + 180 * 86400000,
    deviceLabel: detectDeviceLabel()
  });
}

async function parseErrorResponse(resp) {
  let payload = null;
  try {
    payload = await resp.json();
  } catch {
    payload = null;
  }
  const err = new Error(payload?.error || `Erreur serveur (HTTP ${resp.status})`);
  err.status = resp.status;
  err.code = payload?.code || '';
  err.retryAfterSec = payload?.retryAfterSec || Number(resp.headers.get('Retry-After')) || 0;
  return err;
}

export async function refreshAccessToken() {
  if (!currentSession?.refreshToken) return { ok: false, reason: 'NO_SESSION' };
  const base = getApiBaseUrl();
  if (!base) return { ok: false, reason: 'NO_API' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    // Règle d'or hors-ligne : on conserve la session intacte
    return { ok: false, offline: true };
  }

  if (activeRefreshPromise) return activeRefreshPromise;

  activeRefreshPromise = (async () => {
    try {
      const resp = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: currentSession.refreshToken,
          deviceLabel: detectDeviceLabel()
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const next = buildSessionFromAuthPayload(data, currentSession.user);
        if (next) {
          await persistSession(next);
          return { ok: true };
        }
        return { ok: false };
      }

      if (resp.status === 401) {
        let data = null;
        try { data = await resp.json(); } catch { data = null; }
        // Déconnexion UNIQUEMENT sur révocation explicite du serveur
        if (data?.code === 'TOKEN_REVOKED') {
          await persistSession(null);
          return { ok: false, revoked: true, error: data.error || 'Session expirée ou révoquée.' };
        }
      }

      // 429, 5xx ou autre : on ne déconnecte JAMAIS l'utilisateur
      return { ok: false, transient: true, status: resp.status };
    } catch {
      // Coupure réseau / avion : on conserve la session
      return { ok: false, offline: true };
    }
  })().finally(() => {
    activeRefreshPromise = null;
  });

  return activeRefreshPromise;
}

export async function authFetch(path, options = {}) {
  const base = getApiBaseUrl();
  if (!base) {
    const err = new Error('Serveur Cloudflare non configuré.');
    err.code = 'API_NOT_CONFIGURED';
    throw err;
  }
  if (!currentSession?.refreshToken) {
    const err = new Error('Connectez-vous pour accéder à la synchronisation.');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  // Si le jeton d'accès arrive à expiration, on le renouvelle avant l'appel
  if (!currentSession.accessToken || currentSession.accessExpiresAt - Date.now() < ACCESS_REFRESH_MARGIN_MS) {
    if (navigator.onLine) {
      const ref = await refreshAccessToken();
      if (ref.revoked) {
        const err = new Error(ref.error || 'Session révoquée.');
        err.code = 'TOKEN_REVOKED';
        err.status = 401;
        throw err;
      }
    }
  }

  const doRequest = (token) => {
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${base}${path}`, { ...options, headers });
  };

  let resp = await doRequest(currentSession?.accessToken);

  if (resp.status === 401 && currentSession?.refreshToken && navigator.onLine) {
    const ref = await refreshAccessToken();
    if (ref.ok && currentSession?.accessToken) {
      resp = await doRequest(currentSession.accessToken);
    } else if (ref.revoked) {
      const err = new Error(ref.error || 'Session révoquée.');
      err.code = 'TOKEN_REVOKED';
      err.status = 401;
      throw err;
    }
  }

  return resp;
}

async function isolateIfDifferentAccount(nextUserId) {
  if (!nextUserId) return;
  try {
    const prevOwner = await getMeta(LAST_OWNER_KEY);
    if (prevOwner && prevOwner !== nextUserId) {
      await clearUserStoresLocal();
    }
    await setMeta(LAST_OWNER_KEY, nextUserId);
  } catch {
    // Ignoré
  }
}

export async function registerAccount({ email, password, turnstileToken = '', ownerCode = '' }) {
  const base = getApiBaseUrl();
  if (!base) throw new Error('Serveur Cloudflare non encore configuré.');

  const resp = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      deviceLabel: detectDeviceLabel(),
      turnstileToken,
      ...(ownerCode ? { ownerCode } : {})
    })
  });
  if (!resp.ok) throw await parseErrorResponse(resp);

  const data = await resp.json();
  const next = buildSessionFromAuthPayload(data);
  await isolateIfDifferentAccount(next?.user?.id);
  await persistSession(next);
  return { user: next.user, recoveryKey: data.recoveryKey };
}

export async function loginAccount({ email, password, turnstileToken = '' }) {
  const base = getApiBaseUrl();
  if (!base) throw new Error('Serveur Cloudflare non encore configuré.');

  const resp = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      deviceLabel: detectDeviceLabel(),
      turnstileToken
    })
  });
  if (!resp.ok) throw await parseErrorResponse(resp);

  const data = await resp.json();
  const next = buildSessionFromAuthPayload(data);
  await isolateIfDifferentAccount(next?.user?.id);
  await persistSession(next);
  return { user: next.user };
}

export async function recoverAccount({ email, recoveryKey, newPassword, turnstileToken = '' }) {
  const base = getApiBaseUrl();
  if (!base) throw new Error('Serveur Cloudflare non encore configuré.');

  const resp = await fetch(`${base}/api/auth/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      recoveryKey,
      newPassword,
      deviceLabel: detectDeviceLabel(),
      turnstileToken
    })
  });
  if (!resp.ok) throw await parseErrorResponse(resp);

  const data = await resp.json();
  const next = buildSessionFromAuthPayload(data);
  await isolateIfDifferentAccount(next?.user?.id);
  await persistSession(next);
  return { user: next.user, recoveryKey: data.recoveryKey };
}

export async function changePassword({ currentPassword, newPassword }) {
  const resp = await authFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword,
      newPassword,
      deviceLabel: detectDeviceLabel()
    })
  });
  if (!resp.ok) throw await parseErrorResponse(resp);

  const data = await resp.json();
  const next = buildSessionFromAuthPayload(data, currentSession?.user);
  await persistSession(next);
  return { ok: true };
}

export async function listSessions() {
  const resp = await authFetch('/api/auth/sessions', { method: 'GET' });
  if (!resp.ok) throw await parseErrorResponse(resp);
  return resp.json();
}

export async function revokeSession(sessionId) {
  const resp = await authFetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  });
  if (!resp.ok) throw await parseErrorResponse(resp);
  if (sessionId === currentSession?.sessionId) {
    await persistSession(null);
  }
  return { ok: true };
}

export async function logoutAccount() {
  const base = getApiBaseUrl();
  const token = currentSession?.accessToken;
  const refreshToken = currentSession?.refreshToken;

  // On efface immédiatement en local, et on révoque côté serveur si en ligne
  await persistSession(null);

  if (base && navigator.onLine && (token || refreshToken)) {
    try {
      await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ refreshToken })
      });
    } catch {
      // Ignoré si hors-ligne
    }
  }
}
