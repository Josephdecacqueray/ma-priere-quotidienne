export function emptyState() {
  return {
    updatedAt: 0,
    prayers: [],
    novenas: [],
    intentions: [],
    deletedIds: {
      prayers: {},
      novenas: {},
      intentions: {}
    }
  };
}

function normalizeDeletedMap(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [id, ts] of Object.entries(map)) {
    const n = Number(ts) || 0;
    if (id && n > 0) out[id] = n;
  }
  return out;
}

function mergeCollection(serverItems = [], clientItems = [], deletedMap = {}) {
  const byId = new Map();

  for (const item of serverItems) {
    if (!item || !item.id) continue;
    byId.set(item.id, item);
  }

  for (const item of clientItems) {
    if (!item || !item.id) continue;
    const prev = byId.get(item.id);
    if (!prev || (Number(item.updatedAt) || 0) >= (Number(prev.updatedAt) || 0)) {
      byId.set(item.id, item);
    }
  }

  const merged = [];
  for (const item of byId.values()) {
    const delTs = Number(deletedMap[item.id]) || 0;
    const itemTs = Number(item.updatedAt) || 0;
    if (delTs > 0 && delTs >= itemTs) continue;
    merged.push(item);
  }

  merged.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  return merged;
}

export function mergeStates(rawServer, rawClient) {
  const server = rawServer || emptyState();
  const client = rawClient || emptyState();

  const deletedIds = {
    prayers: {},
    novenas: {},
    intentions: {}
  };

  for (const kind of ['prayers', 'novenas', 'intentions']) {
    const sMap = normalizeDeletedMap(server.deletedIds?.[kind]);
    const cMap = normalizeDeletedMap(client.deletedIds?.[kind]);
    const allKeys = new Set([...Object.keys(sMap), ...Object.keys(cMap)]);
    for (const id of allKeys) {
      deletedIds[kind][id] = Math.max(sMap[id] || 0, cMap[id] || 0);
    }
  }

  return {
    updatedAt: Math.max(Date.now(), Number(server.updatedAt) || 0, Number(client.updatedAt) || 0),
    prayers: mergeCollection(server.prayers, client.prayers, deletedIds.prayers),
    novenas: mergeCollection(server.novenas, client.novenas, deletedIds.novenas),
    intentions: mergeCollection(server.intentions, client.intentions, deletedIds.intentions),
    deletedIds
  };
}
