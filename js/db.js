const DB_NAME = 'ma_priere_quotidienne_db';
const DB_VERSION = 2;

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
  const row = await txPromise('meta', 'readonly', (s) => s.get(key));
  return row ? row.value : undefined;
}

export async function setMeta(key, value) {
  return txPromise('meta', 'readwrite', (s) => s.put({ key, value }));
}

export async function initDbAndSeed() {
  await openDb();
  const seeded = await getMeta('seeded_v1');
  if (!seeded) {
    await txPromise('prayers', 'readwrite', (s) => s.put({
      ...SAINT_JOSEPH_PRAYER,
      createdAt: 1,
      updatedAt: 1
    }));
    await setMeta('seeded_v1', true);
  }
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
  return txPromise('prayers', 'readonly', (s) => s.get(id));
}

export async function savePrayer(prayer) {
  const toSave = {
    pinned: false,
    folder: '',
    ...prayer
  };
  const hasBin = Boolean(getPrayerBinary(toSave));
  if ((toSave.type === 'pdf' || toSave.type === 'image') && hasBin && typeof toSave.pdfSynced !== 'boolean') {
    toSave.pdfSynced = false;
  }
  await txPromise('prayers', 'readwrite', (s) => s.put(toSave));
  await markSyncDirty(true);
}

export async function updatePrayerPdfSync(id, synced) {
  const prayer = await getPrayer(id);
  if (!prayer) return;
  prayer.pdfSynced = Boolean(synced);
  await txPromise('prayers', 'readwrite', (s) => s.put(prayer));
}

export async function attachPdfBlobFromServer(id, blob) {
  const prayer = await getPrayer(id);
  if (!prayer) return;
  if (prayer.type === 'image') {
    prayer.mediaBlob = blob;
  } else {
    prayer.pdfBlob = blob;
  }
  prayer.pdfSynced = true;
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

export async function exportSyncPayload() {
  const [prayers, novenas, intentions, deletedIds] = await Promise.all([
    getAllPrayers(),
    getAllNovenas(),
    getAllIntentions(),
    getDeletedIds()
  ]);

  const serializablePrayers = prayers.map((p) => {
    const { pdfBlob, mediaBlob, pdfSynced, ...rest } = p;
    return {
      ...rest,
      pinned: Boolean(p.pinned),
      folder: p.folder || '',
      hasPdf: p.type === 'pdf' || p.type === 'image'
    };
  });

  return {
    updatedAt: Date.now(),
    prayers: serializablePrayers,
    novenas,
    intentions,
    deletedIds
  };
}

export async function replaceAllFromMergedState(mergedState) {
  const db = await openDb();
  const existingPrayers = await getAllPrayers();
  const binById = new Map();
  for (const p of existingPrayers) {
    if (p.pdfBlob || p.mediaBlob) {
      binById.set(p.id, {
        pdfBlob: p.pdfBlob,
        mediaBlob: p.mediaBlob,
        pdfSynced: Boolean(p.pdfSynced)
      });
    }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['prayers', 'novenas', 'intentions', 'meta'], 'readwrite');
    const pStore = tx.objectStore('prayers');
    const nStore = tx.objectStore('novenas');
    const iStore = tx.objectStore('intentions');
    const mStore = tx.objectStore('meta');

    pStore.clear();
    for (const p of mergedState.prayers || []) {
      const localBin = binById.get(p.id);
      pStore.put({
        ...p,
        ...(localBin?.pdfBlob ? { pdfBlob: localBin.pdfBlob } : {}),
        ...(localBin?.mediaBlob ? { mediaBlob: localBin.mediaBlob } : {}),
        ...(localBin ? { pdfSynced: localBin.pdfSynced } : {})
      });
    }

    nStore.clear();
    for (const n of mergedState.novenas || []) {
      nStore.put(n);
    }

    iStore.clear();
    for (const item of mergedState.intentions || []) {
      iStore.put(item);
    }

    if (mergedState.deletedIds) {
      mStore.put({ key: 'deletedIds', value: mergedState.deletedIds });
    }
    mStore.put({ key: 'lastSyncAt', value: Date.now() });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
    if (bin && bin.size <= 8 * 1024 * 1024) {
      rest.embeddedDataUrl = await blobToDataUrl(bin);
    }
    encodedPrayers.push(rest);
  }

  return {
    version: 2,
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

  for (const p of backup.prayers || []) {
    if (!p?.id) continue;
    const { embeddedDataUrl, ...rest } = p;
    const item = { ...rest, updatedAt: Number(p.updatedAt) || now };
    if (embeddedDataUrl) {
      const blob = dataUrlToBlob(embeddedDataUrl);
      if (item.type === 'image') item.mediaBlob = blob;
      else item.pdfBlob = blob;
      item.pdfSynced = false;
    }
    await savePrayer(item);
  }

  for (const n of backup.novenas || []) {
    if (!n?.id) continue;
    await saveNovena({ ...n, updatedAt: Number(n.updatedAt) || now });
  }

  for (const i of backup.intentions || []) {
    if (!i?.id) continue;
    await saveIntention({ ...i, updatedAt: Number(i.updatedAt) || now });
  }
}

export function generateId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
