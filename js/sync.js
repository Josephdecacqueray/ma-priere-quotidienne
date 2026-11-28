/* =========================================================
   SYNCHRONISATION MULTI-UTILISATEURS v8 (CLOUDFLARE D1)
   - Uniquement texte & métadonnées (ZÉRO binaire PDF envoyé au serveur)
   - Détection d'empreinte (contentHash) : 0 requête si rien n'a changé
   - Backoff exponentiel doux sur 429 / 5xx / perte réseau
   - Vidage automatique de la file hors-ligne de contact (feedbackQueue)
   ========================================================= */

import {
  exportSyncPayload,
  computePayloadFingerprint,
  replaceAllFromMergedState,
  markSyncDirty,
  isSyncDirty,
  getMeta,
  setMeta,
  getFeedbackQueue,
  removeFeedbackQueueItem
} from './db.js';
import { getApiBaseUrl } from './config.js';
import { isSignedIn, authFetch } from './auth.js';

let activeSyncPromise = null;
let backoffUntil = 0;
let consecutiveFailures = 0;

function recordFailure(retryAfterSec = 0) {
  consecutiveFailures = Math.min(6, consecutiveFailures + 1);
  const waitMs = retryAfterSec > 0
    ? retryAfterSec * 1000
    : Math.min(5 * 60 * 1000, 4000 * (2 ** (consecutiveFailures - 1)));
  backoffUntil = Date.now() + waitMs;
}

function resetBackoff() {
  consecutiveFailures = 0;
  backoffUntil = 0;
}

export async function flushFeedbackQueue() {
  const base = getApiBaseUrl();
  if (!base || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return { flushed: 0 };
  }
  const queued = await getFeedbackQueue();
  if (!queued.length) return { flushed: 0 };

  let flushed = 0;
  for (const item of queued) {
    try {
      const resp = await fetch(`${base}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload)
      });
      if (resp.ok || resp.status === 400) {
        await removeFeedbackQueueItem(item.id);
        if (resp.ok) flushed += 1;
      } else if (resp.status === 429) {
        break;
      }
    } catch {
      break;
    }
  }
  return { flushed };
}

async function runSync({ keepalive = false, force = false, pullOnly = false, onStatus } = {}) {
  const base = getApiBaseUrl();

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    onStatus?.('offline');
    return { ok: false, offline: true };
  }

  // Vider les messages de contact en attente dès le retour en ligne
  if (!keepalive && base) {
    flushFeedbackQueue().catch(() => {});
  }

  if (!base || !isSignedIn()) {
    onStatus?.('local');
    return { ok: false, localOnly: true };
  }

  if (!force && Date.now() < backoffUntil) {
    onStatus?.('error');
    return { ok: false, backedOff: true };
  }

  const payload = await exportSyncPayload();
  const localFp = await computePayloadFingerprint(payload);
  const lastFp = await getMeta('lastSyncedFingerprint');
  const dirty = await isSyncDirty();

  // Économie maximale de requêtes gratuites : si rien n'a changé et qu'on ne force pas un pull
  if (!force && !dirty && !pullOnly && lastFp && localFp === lastFp) {
    onStatus?.('synced');
    return { ok: true, skipped: true };
  }

  if (keepalive) {
    if (!dirty && lastFp === localFp) {
      return { ok: true, skipped: true };
    }
    const bodyStr = JSON.stringify(payload);
    if (bodyStr.length >= 60000) return { ok: false };
    try {
      const resp = await authFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        keepalive: true
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.state) await replaceAllFromMergedState(data.state);
        const postFp = await computePayloadFingerprint(await exportSyncPayload());
        await setMeta('lastSyncedFingerprint', postFp);
        await markSyncDirty(false);
        resetBackoff();
        onStatus?.('synced');
        return { ok: true };
      }
    } catch {
      return { ok: false };
    }
    return { ok: false };
  }

  onStatus?.('syncing');
  try {
    const shouldPost = force || dirty || !lastFp || localFp !== lastFp;
    let resp;
    if (!shouldPost && pullOnly) {
      resp = await authFetch('/api/sync', { method: 'GET' });
    } else {
      resp = await authFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (resp.status === 429) {
      const retryAfter = Number(resp.headers.get('Retry-After')) || 30;
      recordFailure(retryAfter);
      onStatus?.('error');
      return { ok: false, rateLimited: true };
    }

    if (resp.status === 413) {
      onStatus?.('quota');
      return { ok: false, quotaExceeded: true };
    }

    if (!resp.ok) {
      recordFailure();
      onStatus?.(navigator.onLine ? 'error' : 'offline');
      return { ok: false, status: resp.status };
    }

    const data = await resp.json();
    const mergedState = data?.state;
    if (mergedState) {
      await replaceAllFromMergedState(mergedState);
    }

    const postFp = await computePayloadFingerprint(await exportSyncPayload());
    await setMeta('lastSyncedFingerprint', postFp);
    if (typeof data?.textBytesUsed === 'number') {
      await setMeta('lastTextBytesUsed', data.textBytesUsed);
    }
    await markSyncDirty(false);
    resetBackoff();
    onStatus?.('synced');
    return { ok: true, state: mergedState, textBytesUsed: data?.textBytesUsed };
  } catch (err) {
    if (err?.code === 'TOKEN_REVOKED') {
      onStatus?.('revoked');
      return { ok: false, revoked: true };
    }
    recordFailure();
    onStatus?.(navigator.onLine ? 'error' : 'offline');
    return { ok: false, error: err };
  }
}

export function syncWithServer(options = {}) {
  if (options.keepalive) {
    return runSync(options);
  }
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  activeSyncPromise = runSync(options).finally(() => {
    activeSyncPromise = null;
  });
  return activeSyncPromise;
}
