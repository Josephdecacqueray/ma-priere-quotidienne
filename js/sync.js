import {
  exportSyncPayload,
  replaceAllFromMergedState,
  getAllPrayers,
  updatePrayerPdfSync,
  attachPdfBlobFromServer,
  markSyncDirty
} from './db.js';

export const SYNC_API_URL = 'https://ma-priere-sync-vhnxufuw4q-ew.a.run.app';

let activeSyncPromise = null;

export async function deleteServerPdf(id) {
  if (!navigator.onLine) return;
  try {
    await fetch(`${SYNC_API_URL}/api/pdfs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      keepalive: true
    });
  } catch {
    // Ignoré : sera retenté ou sans impact sur la liste
  }
}

async function runSync({ keepalive = false, onStatus } = {}) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    onStatus?.('offline');
    return { ok: false, offline: true };
  }

  const payload = await exportSyncPayload();
  const bodyStr = JSON.stringify(payload);

  // Lors de la fermeture / mise en arrière-plan iPhone, keepalive permet au navigateur de finir la requête
  if (keepalive) {
    const canKeepalive = bodyStr.length < 60000;
    try {
      const resp = await fetch(`${SYNC_API_URL}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        keepalive: canKeepalive
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.state) {
          await replaceAllFromMergedState(data.state);
        }
        await markSyncDirty(false);
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
    const resp = await fetch(`${SYNC_API_URL}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const mergedState = data?.state;
    if (mergedState) {
      await replaceAllFromMergedState(mergedState);
    }

    // Synchroniser les fichiers PDF (envoi des nouveaux + téléchargement des manquants)
    const localPrayers = await getAllPrayers();
    for (const p of localPrayers) {
      if (p.type !== 'pdf') continue;
      if (p.pdfBlob && !p.pdfSynced) {
        const putResp = await fetch(`${SYNC_API_URL}/api/pdfs/${encodeURIComponent(p.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: p.pdfBlob
        });
        if (putResp.ok) {
          await updatePrayerPdfSync(p.id, true);
        }
      } else if (!p.pdfBlob) {
        const getResp = await fetch(`${SYNC_API_URL}/api/pdfs/${encodeURIComponent(p.id)}`);
        if (getResp.ok) {
          const blob = await getResp.blob();
          if (blob.size > 0) {
            await attachPdfBlobFromServer(p.id, blob);
          }
        }
      }
    }

    await markSyncDirty(false);
    onStatus?.('synced');
    return { ok: true, state: mergedState };
  } catch (err) {
    console.warn('Sync failed:', err);
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
