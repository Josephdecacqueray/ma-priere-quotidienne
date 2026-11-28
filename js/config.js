/* =========================================================
   CONFIGURATION APPLICATION v8 (ZERO SECRET DANS LE CLIENT)
   - L'URL du Worker Cloudflare est publique (sans aucun secret)
   - Le Client ID Google OAuth (drive.appdata uniquement) est public
   - Aucune adresse e-mail personnelle, aucune clé privée ici
   ========================================================= */

export const APP_VERSION = '8.0.0';

// Après avoir déployé `worker/` (npx wrangler deploy), renseignez l'URL de votre Worker ici
// ou directement depuis « Compte & Synchronisation -> Serveur » dans l'application.
// Exemple : 'https://ma-priere-api.<votre-sous-domaine>.workers.dev'
export const DEFAULT_API_BASE_URL = '';

// Client ID OAuth Web Google (optionnel, pour la synchronisation 5 Go PDF via drive.appdata)
// Exemple : '1234567890-abcdef.apps.googleusercontent.com'
export const DEFAULT_GOOGLE_CLIENT_ID = '';

const API_URL_STORAGE_KEY = 'mpq_api_base_url';
const GOOGLE_CLIENT_ID_STORAGE_KEY = 'mpq_google_client_id';

let cachedServerConfig = null;
let serverConfigPromise = null;

function isSafeApiUrl(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return u.origin;
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
      return u.origin;
    }
    return '';
  } catch {
    return '';
  }
}

export function getApiBaseUrl() {
  if (typeof window !== 'undefined' && window.__MPQ_API_URL__) {
    const testUrl = isSafeApiUrl(window.__MPQ_API_URL__);
    if (testUrl) return testUrl;
  }
  try {
    const override = isSafeApiUrl(localStorage.getItem(API_URL_STORAGE_KEY));
    if (override) return override;
  } catch {
    // Stockage indisponible
  }
  return isSafeApiUrl(DEFAULT_API_BASE_URL);
}

export function setCustomApiBaseUrl(url) {
  const clean = isSafeApiUrl(url);
  cachedServerConfig = null;
  serverConfigPromise = null;
  try {
    if (clean) localStorage.setItem(API_URL_STORAGE_KEY, clean);
    else localStorage.removeItem(API_URL_STORAGE_KEY);
  } catch {
    // Ignoré
  }
  return clean;
}

export function getGoogleClientId() {
  if (typeof window !== 'undefined' && window.__MPQ_GOOGLE_CLIENT_ID__) {
    return String(window.__MPQ_GOOGLE_CLIENT_ID__).trim();
  }
  try {
    const saved = localStorage.getItem(GOOGLE_CLIENT_ID_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // Ignoré
  }
  return DEFAULT_GOOGLE_CLIENT_ID.trim();
}

export function setCustomGoogleClientId(clientId) {
  const clean = String(clientId || '').trim();
  try {
    if (clean) localStorage.setItem(GOOGLE_CLIENT_ID_STORAGE_KEY, clean);
    else localStorage.removeItem(GOOGLE_CLIENT_ID_STORAGE_KEY);
  } catch {
    // Ignoré
  }
  return clean;
}

export async function fetchServerConfig({ force = false } = {}) {
  const base = getApiBaseUrl();
  if (!base) {
    return {
      configured: false,
      maxUsers: 1000,
      maxTextBytes: 2097152,
      vapidPublicKey: '',
      turnstileSiteKey: ''
    };
  }
  if (!force && cachedServerConfig) return cachedServerConfig;
  if (!force && serverConfigPromise) return serverConfigPromise;

  serverConfigPromise = fetch(`${base}/api/config`, { method: 'GET' })
    .then(async (resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      cachedServerConfig = {
        configured: true,
        maxUsers: Number(data.maxUsers) || 1000,
        maxTextBytes: Number(data.maxTextBytes) || 2097152,
        vapidPublicKey: String(data.vapidPublicKey || ''),
        turnstileSiteKey: String(data.turnstileSiteKey || '')
      };
      return cachedServerConfig;
    })
    .catch(() => ({
      configured: true,
      offline: true,
      maxUsers: 1000,
      maxTextBytes: 2097152,
      vapidPublicKey: '',
      turnstileSiteKey: ''
    }))
    .finally(() => {
      serverConfigPromise = null;
    });

  return serverConfigPromise;
}
