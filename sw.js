const CACHE_NAME = 'ma-priere-v8-2';

// App Shell ultra-léger au démarrage (0 octet du corpus CEC/Thomas bloquant au boot)
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/auth.js',
  './js/db.js',
  './js/formatter.js',
  './js/ics.js',
  './js/liturgy.js',
  './js/pdf-viewer.js',
  './js/push.js',
  './js/rosary.js',
  './js/sync.js',
  './js/account-ui.js',
  './js/drive-sync.js',
  './js/feedback.js',
  './js/la-priere.js',
  './js/tour.js',
  './js/timer.js',
  './fonts/GreatVibes-Regular.ttf',
  './icons/favicon-64.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Ressources lourdes (lecteur PDF + 66 textes + 10 guides) précachées silencieusement après load/idle
const OFFLINE_EXTRA_ASSETS = [
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './data/la-priere/index.json',
  './data/la-priere/guides.json'
];

let corpusPrecacheRunning = false;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function broadcastToClients(msg) {
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage(msg);
  }
}

async function computeCorpusStatus() {
  const cache = await caches.open(CACHE_NAME);
  const idxResp = await cache.match('./data/la-priere/index.json');
  if (!idxResp) {
    return { ready: false, cached: 0, total: 68 };
  }
  try {
    const idx = await idxResp.clone().json();
    const urls = [
      ...OFFLINE_EXTRA_ASSETS,
      ...(idx.texts || []).map((t) => `./data/la-priere/texts/${encodeURIComponent(t.id)}.json`)
    ];
    let cached = 0;
    for (const u of urls) {
      if (await cache.match(u)) cached += 1;
    }
    return {
      ready: cached >= urls.length && urls.length > 0,
      cached,
      total: urls.length,
      textsCount: (idx.texts || []).length,
      guidesCount: (idx.guides || []).length
    };
  } catch {
    return { ready: false, cached: 0, total: 68 };
  }
}

async function precacheOfflineCorpus() {
  if (corpusPrecacheRunning) return;
  corpusPrecacheRunning = true;
  try {
    const cache = await caches.open(CACHE_NAME);

    // 1. Récupérer index.json pour connaître l'ensemble des 66 textes
    let idxResp = await cache.match('./data/la-priere/index.json');
    if (!idxResp) {
      const fetched = await fetch('./data/la-priere/index.json');
      if (fetched && fetched.ok) {
        await cache.put('./data/la-priere/index.json', fetched.clone());
        idxResp = fetched;
      }
    }
    if (!idxResp) {
      await broadcastToClients({ type: 'OFFLINE_CORPUS_STATUS', ready: false, cached: 0, total: 68 });
      return;
    }

    const idx = await idxResp.clone().json();
    const allUrls = [
      ...OFFLINE_EXTRA_ASSETS,
      ...(idx.texts || []).map((t) => `./data/la-priere/texts/${encodeURIComponent(t.id)}.json`)
    ];

    const missing = [];
    for (const u of allUrls) {
      if (!(await cache.match(u))) {
        missing.push(u);
      }
    }

    // Téléchargement doux par petits lots de 6 pour ne jamais saturer le réseau/CPU mobile
    const batchSize = 6;
    for (let i = 0; i < missing.length; i += batchSize) {
      const slice = missing.slice(i, i + batchSize);
      await Promise.all(
        slice.map(async (u) => {
          try {
            const resp = await fetch(u);
            if (resp && resp.ok) {
              await cache.put(u, resp);
            }
          } catch {
            // Hors-ligne en cours de téléchargement : repris au prochain retour en ligne
          }
        })
      );
    }

    const status = await computeCorpusStatus();
    await broadcastToClients({ type: 'OFFLINE_CORPUS_STATUS', ...status });
  } catch {
    // Ignoré si hors-ligne
  } finally {
    corpusPrecacheRunning = false;
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'PRECACHE_OFFLINE_CORPUS') {
    event.waitUntil(precacheOfflineCorpus());
  } else if (data.type === 'GET_OFFLINE_CORPUS_STATUS') {
    event.waitUntil(
      computeCorpusStatus().then((status) => {
        if (event.source && 'postMessage' in event.source) {
          event.source.postMessage({ type: 'OFFLINE_CORPUS_STATUS', ...status });
        } else {
          return broadcastToClients({ type: 'OFFLINE_CORPUS_STATUS', ...status });
        }
        return undefined;
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Ne jamais intercepter ni mettre en cache les appels API ou externes
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const networkFetch = fetch(req).then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return resp;
        }).catch(() => cached || caches.match('./index.html'));
        return cached || networkFetch;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return resp;
      });
    })
  );
});

/* Notifications Web Push iOS & Android */
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Ma prière quotidienne',
    body: 'Moment de prière pour votre neuvaine.',
    url: './'
  };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icons/icon-192.png?v=2',
      badge: './icons/favicon-64.png?v=2',
      tag: payload.tag || 'ma-priere-push',
      data: { url: payload.url || './' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
