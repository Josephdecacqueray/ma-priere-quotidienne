const DB_NAME = 'ma_priere_quotidienne_db';
const DB_VERSION = 1;

export const SAINT_JOSEPH_PRAYER = {
  id: 'prayer-saint-joseph',
  type: 'text',
  title: 'Prière à saint Joseph',
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

export async function initDbAndSeed() {
  await openDb();
  const seeded = await txPromise('meta', 'readonly', (s) => s.get('seeded_v1'));
  if (!seeded) {
    const now = Date.now();
    await txPromise('prayers', 'readwrite', (s) => s.put({
      ...SAINT_JOSEPH_PRAYER,
      createdAt: now,
      updatedAt: now
    }));
    await txPromise('meta', 'readwrite', (s) => s.put({ key: 'seeded_v1', value: true }));
  }
}

export async function getAllPrayers() {
  const list = await txPromise('prayers', 'readonly', (s) => s.getAll());
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getPrayer(id) {
  return txPromise('prayers', 'readonly', (s) => s.get(id));
}

export async function savePrayer(prayer) {
  return txPromise('prayers', 'readwrite', (s) => s.put(prayer));
}

export async function deletePrayer(id) {
  return txPromise('prayers', 'readwrite', (s) => s.delete(id));
}

export async function getAllNovenas() {
  const list = await txPromise('novenas', 'readonly', (s) => s.getAll());
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getNovena(id) {
  return txPromise('novenas', 'readonly', (s) => s.get(id));
}

export async function saveNovena(novena) {
  return txPromise('novenas', 'readwrite', (s) => s.put(novena));
}

export async function deleteNovena(id) {
  return txPromise('novenas', 'readwrite', (s) => s.delete(id));
}

export function generateId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
