/* =========================================================
   SYNCHRONISATION 5 Go PDF & PHOTOS VIA GOOGLE DRIVE PERSONNEL
   - Scope STRICTEMENT non sensible : https://www.googleapis.com/auth/drive.appdata
   - Aucun accès aux autres fichiers du Drive de l'utilisateur
   - Transfert direct Navigateur <-> Google Drive (0 octet binaire sur notre serveur)
   - Chargé dynamiquement à la demande (zéro impact sur le boot accueil)
   ========================================================= */

import {
  getAllPrayers,
  getPrayerBinary,
  updatePrayerDriveMeta,
  attachMediaBlob,
  computeBlobSha256
} from './db.js';
import { getGoogleClientId } from './config.js';

const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_SYNC_FLAG_KEY = 'mpq_drive_sync_enabled';
const SETTINGS_UPDATED_KEY = 'mpq_settings_updated_at';

let gisLoadPromise = null;
let memoryAccessToken = '';
let memoryTokenExpiresAt = 0;

function getMock() {
  return typeof window !== 'undefined' && window.__MPQ_DRIVE_MOCK__ ? window.__MPQ_DRIVE_MOCK__ : null;
}

export function isDriveSyncEnabled() {
  try {
    return localStorage.getItem(DRIVE_SYNC_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDriveSyncEnabled(enabled) {
  try {
    localStorage.setItem(DRIVE_SYNC_FLAG_KEY, enabled ? '1' : '0');
    localStorage.setItem(SETTINGS_UPDATED_KEY, String(Date.now()));
  } catch {
    // Ignoré
  }
}

export function isDriveConfigured() {
  return Boolean(getMock() || getGoogleClientId());
}

export function hasActiveDriveToken() {
  if (getMock()) return Boolean(getMock().connected);
  return Boolean(memoryAccessToken && Date.now() < memoryTokenExpiresAt - 30000);
}

function loadGisScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google.accounts.oauth2);
      else {
        gisLoadPromise = null;
        reject(new Error('Google Identity Services indisponible.'));
      }
    };
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error('Impossible de charger Google Sign-In (vérifiez votre connexion).'));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

export async function connectGoogleDrive({ prompt = 'consent' } = {}) {
  const mock = getMock();
  if (mock) {
    mock.connected = true;
    setDriveSyncEnabled(true);
    return 'mock-drive-token';
  }

  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID_MISSING');
  }

  if (hasActiveDriveToken()) {
    return memoryAccessToken;
  }

  const oauth2 = await loadGisScript();
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_APPDATA_SCOPE,
      callback: (resp) => {
        if (resp?.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        memoryAccessToken = resp.access_token || '';
        memoryTokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3500) * 1000;
        setDriveSyncEnabled(true);
        resolve(memoryAccessToken);
      },
      error_callback: (err) => {
        reject(new Error(err?.message || 'Autorisation Google Drive annulée.'));
      }
    });
    client.requestAccessToken({ prompt });
  });
}

export function disconnectGoogleDrive() {
  const mock = getMock();
  if (mock) {
    mock.connected = false;
  }
  if (memoryAccessToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(memoryAccessToken, () => {});
    } catch {
      // Ignoré
    }
  }
  memoryAccessToken = '';
  memoryTokenExpiresAt = 0;
  setDriveSyncEnabled(false);
}

async function ensureDriveToken() {
  if (hasActiveDriveToken()) return memoryAccessToken || 'mock-drive-token';
  return connectGoogleDrive({ prompt: '' });
}

export async function uploadPrayerMediaToDrive(prayer) {
  const bin = getPrayerBinary(prayer);
  if (!bin) return null;

  const sha256 = prayer.fileSha256 || (await computeBlobSha256(bin));
  const mimeType = bin.type || prayer.mimeType || (prayer.type === 'pdf' ? 'application/pdf' : 'image/jpeg');
  const fileName = prayer.fileName || `${prayer.id}.${prayer.type === 'pdf' ? 'pdf' : 'jpg'}`;

  const mock = getMock();
  if (mock) {
    const fileId = await mock.upload({ prayerId: prayer.id, fileName, mimeType, sha256, blob: bin });
    await updatePrayerDriveMeta(prayer.id, { driveFileId: fileId, fileSha256: sha256, pdfSynced: true });
    return fileId;
  }

  const token = await ensureDriveToken();
  const metadata = {
    name: fileName,
    mimeType,
    parents: ['appDataFolder'],
    appProperties: {
      prayerId: prayer.id,
      sha256
    }
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', bin, fileName);

  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  if (!resp.ok) {
    throw new Error(`Échec envoi Google Drive (HTTP ${resp.status})`);
  }
  const data = await resp.json();
  if (!data?.id) throw new Error('Réponse Google Drive incomplète.');

  await updatePrayerDriveMeta(prayer.id, {
    driveFileId: data.id,
    fileSha256: sha256,
    pdfSynced: true
  });
  return data.id;
}

export async function downloadPrayerMediaFromDrive(prayer) {
  if (!prayer?.driveFileId) {
    throw new Error('NO_DRIVE_FILE_ID');
  }

  const mock = getMock();
  let blob;
  if (mock) {
    blob = await mock.download(prayer.driveFileId);
  } else {
    const token = await ensureDriveToken();
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(prayer.driveFileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      throw new Error(`Téléchargement Google Drive impossible (HTTP ${resp.status})`);
    }
    blob = await resp.blob();
  }

  if (!blob || blob.size === 0) {
    throw new Error('Fichier vide reçu depuis Google Drive.');
  }

  if (prayer.fileSha256) {
    const actualSha = await computeBlobSha256(blob);
    if (actualSha && actualSha !== prayer.fileSha256) {
      throw new Error('Intégrité du fichier non vérifiée (SHA-256 différent).');
    }
  }

  await attachMediaBlob(prayer.id, blob, { driveFileId: prayer.driveFileId });
  return blob;
}

export async function deleteDriveFile(driveFileId) {
  if (!driveFileId || !isDriveSyncEnabled()) return;
  const mock = getMock();
  if (mock) {
    await mock.delete?.(driveFileId);
    return;
  }
  if (!hasActiveDriveToken() || !navigator.onLine) return;
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memoryAccessToken}` }
    });
  } catch {
    // Ignoré
  }
}

export async function syncAllMediaWithDrive({ onProgress } = {}) {
  if (!navigator.onLine) {
    return { ok: false, offline: true, uploaded: 0, skipped: 0, failed: 0 };
  }
  await ensureDriveToken();
  const prayers = await getAllPrayers();
  const mediaPrayers = prayers.filter((p) => (p.type === 'pdf' || p.type === 'image') && getPrayerBinary(p));

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < mediaPrayers.length; i += 1) {
    const p = mediaPrayers[i];
    if (p.driveFileId) {
      skipped += 1;
      continue;
    }
    onProgress?.(i + 1, mediaPrayers.length, p.title || p.fileName || 'Fichier');
    try {
      await uploadPrayerMediaToDrive(p);
      uploaded += 1;
    } catch {
      failed += 1;
    }
  }

  return { ok: failed === 0, uploaded, skipped, failed };
}
