const DB_NAME = 'ma_priere_quotidienne_db';
const DB_VERSION = 3;

export const SAINT_JOSEPH_PRAYER = {
  id: 'prayer-saint-joseph',
  type: 'text',
  title: 'Prière à saint Joseph',
  pinned: false,
  folder: '',
  content: `Glorieux saint Joseph,
époux de Marie,
accordez-nous votre protection paternelle,
nous vous en supplions par le Cœur de Jésus-Christ.
O vous dont la puissance infinie
s'étend à toutes nos nécessités
et sait nous rendre possibles
les choses les plus impossibles,
ouvrez vos yeux de père
sur les intérêts de vos enfants.
Dans l'embarras et la peine
qui nous pressent,
nous recourons à vous avec confiance ;
daignez nous prendre sous votre charitable conduite
et réglez pour nous
cette affaire si importante et si difficile, (l'exprimer)
cause de toutes nos inquiétudes.
Faites que son heureuse issue
tourne à la gloire de Dieu
et au bien de ses dévoués serviteurs.`
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('prayers')) {
        const store = db.createObjectStore('prayers', { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('novenas')) {
        const store = db.createObjectStore('novenas', { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('intentions')) {
        const store = db.createObjectStore('intentions', { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('feedbackQueue')) {
        db.createObjectStore('feedbackQueue', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txPromise(storeName, mode, operation) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = operation(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export function getPrayerBinary(prayer) {
  return prayer?.mediaBlob || prayer?.pdfBlob || null;
}

export async function getMeta(key) {
  if (!key) return undefined;
  const row = await txPromise('meta', 'readonly', (s) => s.get(key));
  return row ? row.value : undefined;
}

export async function setMeta(key, value) {
  return txPromise('meta', 'readwrite', (s) => s.put({ key, value }));
}

export async function initDbAndSeed() {
  // Chaque nouvel utilisateur démarre avec un carnet, des intentions et des neuvaines vierges.
  await openDb();
}

export async function clearUserStoresLocal() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['prayers', 'novenas', 'intentions', 'meta'], 'readwrite');
    tx.objectStore('prayers').clear();
    tx.objectStore('novenas').clear();
    tx.objectStore('intentions').clear();
    const mStore = tx.objectStore('meta');
    mStore.delete('deletedIds');
    mStore.delete('lastSyncedFingerprint');
    mStore.delete('syncDirty');
    mStore.delete('lastSyncAt');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function computeBlobSha256(blob) {
  if (!blob || typeof crypto === 'undefined' || !crypto.subtle) return '';
  try {
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && navigator.storage?.persist) {
      const already = await navigator.storage.persisted();
      if (!already) {
        return await navigator.storage.persist();
      }
      return true;
    }
  } catch {
    // Ignoré
  }
  return false;
}

export async function getLocalStorageStats() {
  const prayers = await getAllPrayers();
  let mediaBytes = 0;
  let mediaCount = 0;
  let driveSyncedCount = 0;
  for (const p of prayers) {
    if (p.type === 'pdf' || p.type === 'image') {
      mediaCount += 1;
      const bin = getPrayerBinary(p);
      mediaBytes += bin?.size || p.fileSize || 0;
      if (p.driveFileId) driveSyncedCount += 1;
    }
  }

  let quotaBytes = 0;
  let usageBytes = 0;
  let persisted = false;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quotaBytes = Number(est.quota) || 0;
      usageBytes = Number(est.usage) || 0;
    }
    if (navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted();
    }
  } catch {
    // Ignoré
  }

  return {
    mediaBytes,
    mediaCount,
    driveSyncedCount,
    quotaBytes,
    usageBytes,
    persisted
  };
}

export async function getAllPrayers() {
  const list = await txPromise('prayers', 'readonly', (s) => s.getAll());
  return list.sort((a, b) => {
    const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

export async function getPrayer(id) {
  if (!id) return undefined;
  return txPromise('prayers', 'readonly', (s) => s.get(id));
}

export async function savePrayer(prayer) {
  const toSave = {
    pinned: false,
    folder: '',
    ...prayer
  };
  const bin = getPrayerBinary(toSave);
  if ((toSave.type === 'pdf' || toSave.type === 'image') && bin) {
    if (!toSave.fileSize) toSave.fileSize = bin.size;
    if (!toSave.fileSha256) {
      toSave.fileSha256 = await computeBlobSha256(bin);
    }
    if (typeof toSave.pdfSynced !== 'boolean') {
      toSave.pdfSynced = Boolean(toSave.driveFileId);
    }
  }
  await txPromise('prayers', 'readwrite', (s) => s.put(toSave));
  await markSyncDirty(true);
}

export async function updatePrayerDriveMeta(id, { driveFileId, fileSha256, pdfSynced } = {}) {
  const prayer = await getPrayer(id);
  if (!prayer) return;
  if (driveFileId !== undefined) prayer.driveFileId = driveFileId;
  if (fileSha256 !== undefined) prayer.fileSha256 = fileSha256;
  if (pdfSynced !== undefined) prayer.pdfSynced = Boolean(pdfSynced);
  prayer.updatedAt = Date.now();
  await txPromise('prayers', 'readwrite', (s) => s.put(prayer));
  await markSyncDirty(true);
}

export async function attachMediaBlob(id, blob, { driveFileId } = {}) {
  const prayer = await getPrayer(id);
  if (!prayer) return;
  if (prayer.type === 'image') {
    prayer.mediaBlob = blob;
  } else {
    prayer.pdfBlob = blob;
  }
  prayer.fileSize = blob.size;
  if (!prayer.fileSha256) {
    prayer.fileSha256 = await computeBlobSha256(blob);
  }
  if (driveFileId) prayer.driveFileId = driveFileId;
  prayer.pdfSynced = Boolean(prayer.driveFileId);
  await txPromise('prayers', 'readwrite', (s) => s.put(prayer));
}

export async function deletePrayer(id) {
  await txPromise('prayers', 'readwrite', (s) => s.delete(id));
  await recordDeletion('prayers', id);
  await markSyncDirty(true);
}

export async function getAllNovenas() {
  const list = await txPromise('novenas', 'readonly', (s) => s.getAll());
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getNovena(id) {
  if (!id) return undefined;
  return txPromise('novenas', 'readonly', (s) => s.get(id));
}

export async function saveNovena(novena) {
  await txPromise('novenas', 'readwrite', (s) => s.put(novena));
  await markSyncDirty(true);
}

export async function deleteNovena(id) {
  await txPromise('novenas', 'readwrite', (s) => s.delete(id));
  await recordDeletion('novenas', id);
  await markSyncDirty(true);
}

export async function getAllIntentions() {
  const list = await txPromise('intentions', 'readonly', (s) => s.getAll());
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getIntention(id) {
  if (!id) return undefined;
  return txPromise('intentions', 'readonly', (s) => s.get(id));
}

export async function saveIntention(intention) {
  await txPromise('intentions', 'readwrite', (s) => s.put(intention));
  await markSyncDirty(true);
}

export async function deleteIntention(id) {
  await txPromise('intentions', 'readwrite', (s) => s.delete(id));
  await recordDeletion('intentions', id);
  await markSyncDirty(true);
}

/* File d'attente hors-ligne pour les signalements / suggestions */
export async function getFeedbackQueue() {
  return txPromise('feedbackQueue', 'readonly', (s) => s.getAll());
}

export async function enqueueFeedback(item) {
  return txPromise('feedbackQueue', 'readwrite', (s) => s.put(item));
}

export async function removeFeedbackQueueItem(id) {
  return txPromise('feedbackQueue', 'readwrite', (s) => s.delete(id));
}

export async function getDeletedIds() {
  const existing = await getMeta('deletedIds');
  return {
    prayers: { ...(existing?.prayers || {}) },
    novenas: { ...(existing?.novenas || {}) },
    intentions: { ...(existing?.intentions || {}) }
  };
}

export async function recordDeletion(kind, id, ts = Date.now()) {
  const deleted = await getDeletedIds();
  if (!deleted[kind]) deleted[kind] = {};
  deleted[kind][id] = Math.max(deleted[kind][id] || 0, ts);
  await setMeta('deletedIds', deleted);
}

export async function markSyncDirty(flag = true) {
  await setMeta('syncDirty', Boolean(flag));
}

export async function isSyncDirty() {
  return Boolean(await getMeta('syncDirty'));
}

function readLocalRosaryState() {
  try {
    const raw = JSON.parse(localStorage.getItem('mpq_rosary_counter') || 'null');
    if (raw && raw.groupKey) {
      return {
        groupKey: raw.groupKey,
        decadeIndex: Math.max(0, Math.min(4, Number(raw.decadeIndex) || 0)),
        beadIndex: Math.max(0, Math.min(10, Number(raw.beadIndex) || 0)),
        updatedAt: Number(raw.updatedAt) || Number(localStorage.getItem('mpq_rosary_updated_at')) || 1
      };
    }
  } catch {
    // Ignoré
  }
  return null;
}

function readLocalSettingsState() {
  try {
    return {
      themeMode: localStorage.getItem('mpq_theme_mode') || 'auto',
      fontSizePx: Number(localStorage.getItem('mpq_font_size_px')) || 15.5,
      driveSyncEnabled: localStorage.getItem('mpq_drive_sync_enabled') === '1',
      updatedAt: Number(localStorage.getItem('mpq_settings_updated_at')) || 1
    };
  } catch {
    return null;
  }
}

export async function exportSyncPayload() {
  const [prayers, novenas, intentions, deletedIds] = await Promise.all([
    getAllPrayers(),
    getAllNovenas(),
    getAllIntentions(),
    getDeletedIds()
  ]);

  // ZÉRO binaire PDF/image dans le payload synchronisé vers Cloudflare D1
  const serializablePrayers = prayers.map((p) => {
    const { pdfBlob, mediaBlob, pdfSynced, embeddedDataUrl, ...rest } = p;
    return {
      ...rest,
      pinned: Boolean(p.pinned),
      folder: p.folder || '',
      fileName: p.fileName || '',
      mimeType: p.mimeType || '',
      fileSize: Number(p.fileSize) || 0,
      fileSha256: p.fileSha256 || '',
      driveFileId: p.driveFileId || '',
      hasPdf: p.type === 'pdf' || p.type === 'image'
    };
  });

  const normalizedIntentions = intentions.map((i) => ({
    id: i.id,
    text: i.text,
    done: Boolean(i.done ?? i.answered),
    createdAt: Number(i.createdAt) || 1,
    updatedAt: Number(i.updatedAt) || 1
  }));

  return {
    prayers: serializablePrayers,
    novenas,
    intentions: normalizedIntentions,
    rosaryState: readLocalRosaryState(),
    settings: readLocalSettingsState(),
    deletedIds
  };
}

export async function computePayloadFingerprint(payload) {
  const str = JSON.stringify(payload);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  return `${str.length}:${str.slice(0, 40)}`;
}

export async function replaceAllFromMergedState(mergedState) {
  const db = await openDb();
  const existingPrayers = await getAllPrayers();
  const localById = new Map();
  for (const p of existingPrayers) {
    localById.set(p.id, {
      pdfBlob: p.pdfBlob,
      mediaBlob: p.mediaBlob,
      pdfSynced: Boolean(p.pdfSynced),
      fileSha256: p.fileSha256 || '',
      driveFileId: p.driveFileId || ''
    });
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(['prayers', 'novenas', 'intentions', 'meta'], 'readwrite');
    const pStore = tx.objectStore('prayers');
    const nStore = tx.objectStore('novenas');
    const iStore = tx.objectStore('intentions');
    const mStore = tx.objectStore('meta');

    pStore.clear();
    for (const p of mergedState.prayers || []) {
      const local = localById.get(p.id);
      const driveFileId = p.driveFileId || local?.driveFileId || '';
      const fileSha256 = p.fileSha256 || local?.fileSha256 || '';
      pStore.put({
        ...p,
        ...(fileSha256 ? { fileSha256 } : {}),
        ...(driveFileId ? { driveFileId } : {}),
        ...(local?.pdfBlob ? { pdfBlob: local.pdfBlob } : {}),
        ...(local?.mediaBlob ? { mediaBlob: local.mediaBlob } : {}),
        pdfSynced: Boolean(driveFileId || local?.pdfSynced)
      });
    }

    nStore.clear();
    for (const n of mergedState.novenas || []) {
      nStore.put(n);
    }

    iStore.clear();
    for (const item of mergedState.intentions || []) {
      iStore.put({
        ...item,
        done: Boolean(item.done ?? item.answered)
      });
    }

    if (mergedState.deletedIds) {
      mStore.put({ key: 'deletedIds', value: mergedState.deletedIds });
    }
    mStore.put({ key: 'lastSyncAt', value: Date.now() });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Appliquer l'état du chapelet et les préférences s'ils sont plus récents
  try {
    if (mergedState.rosaryState?.groupKey) {
      const localTs = Number(localStorage.getItem('mpq_rosary_updated_at')) || 0;
      if ((mergedState.rosaryState.updatedAt || 0) > localTs) {
        localStorage.setItem('mpq_rosary_counter', JSON.stringify(mergedState.rosaryState));
        localStorage.setItem('mpq_rosary_updated_at', String(mergedState.rosaryState.updatedAt));
      }
    }
    if (mergedState.settings) {
      const localTs = Number(localStorage.getItem('mpq_settings_updated_at')) || 0;
      if ((mergedState.settings.updatedAt || 0) > localTs) {
        if (mergedState.settings.themeMode) {
          localStorage.setItem('mpq_theme_mode', mergedState.settings.themeMode);
        }
        if (mergedState.settings.fontSizePx) {
          localStorage.setItem('mpq_font_size_px', String(mergedState.settings.fontSizePx));
        }
        localStorage.setItem('mpq_drive_sync_enabled', mergedState.settings.driveSyncEnabled ? '1' : '0');
        localStorage.setItem('mpq_settings_updated_at', String(mergedState.settings.updatedAt));
      }
    }
  } catch {
    // Ignoré
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = String(dataUrl).split(',');
  const mime = (header.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function getBackupWitness() {
  const [lastSyncAt, lastDriveSyncAt, lastBackupExportAt] = await Promise.all([
    getMeta('lastSyncAt'),
    getMeta('lastDriveSyncAt'),
    getMeta('lastBackupExportAt')
  ]);
  return {
    lastSyncAt: Number(lastSyncAt) || 0,
    lastDriveSyncAt: Number(lastDriveSyncAt) || 0,
    lastBackupExportAt: Number(lastBackupExportAt) || 0
  };
}

export async function exportBackupData() {
  const [prayers, novenas, intentions] = await Promise.all([
    getAllPrayers(),
    getAllNovenas(),
    getAllIntentions()
  ]);

  const encodedPrayers = [];
  for (const p of prayers) {
    const { pdfBlob, mediaBlob, ...rest } = p;
    const bin = mediaBlob || pdfBlob;
    if (bin && bin.size <= 12 * 1024 * 1024) {
      rest.embeddedDataUrl = await blobToDataUrl(bin);
    }
    encodedPrayers.push(rest);
  }

  await setMeta('lastBackupExportAt', Date.now());

  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    prayers: encodedPrayers,
    novenas,
    intentions
  };
}

export async function importBackupData(backup) {
  if (!backup || typeof backup !== 'object') {
    throw new Error('Sauvegarde invalide');
  }
  const now = Date.now();
  let importedCount = 0;

  for (const p of backup.prayers || []) {
    if (!p?.id) continue;
    const { embeddedDataUrl, ...rest } = p;
    const item = { ...rest, updatedAt: Number(p.updatedAt) || now };
    if (embeddedDataUrl) {
      const blob = dataUrlToBlob(embeddedDataUrl);
      if (item.type === 'image') item.mediaBlob = blob;
      else item.pdfBlob = blob;
      item.fileSize = blob.size;
      item.pdfSynced = false;
    }
    await savePrayer(item);
    importedCount += 1;
  }

  for (const n of backup.novenas || []) {
    if (!n?.id) continue;
    await saveNovena({ ...n, updatedAt: Number(n.updatedAt) || now });
    importedCount += 1;
  }

  for (const i of backup.intentions || []) {
    if (!i?.id) continue;
    await saveIntention({
      ...i,
      done: Boolean(i.done ?? i.answered),
      updatedAt: Number(i.updatedAt) || now
    });
    importedCount += 1;
  }

  return importedCount;
}

export function generateId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
