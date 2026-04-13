// =============================================
//  SERVICE WORKER - Irene Gipsy Tattoo PWA
//  Strategia: Cache-first per shell, network-first per dati
//  Bump CACHE_VERSION per forzare aggiornamento
// =============================================

const CACHE_VERSION = 'igt-v3';
const CACHE_STATIC = CACHE_VERSION + '-static';
const CACHE_DYNAMIC = CACHE_VERSION + '-dynamic';
const CACHE_IMAGES = CACHE_VERSION + '-images';

// Shell dell'app - precaricata all'installazione
const PRECACHE_URLS = [
  '/',
  '/login.html',
  '/index.html',
  '/dashboard.html',
  '/admin-dashboard.html',
  '/faq.html',
  '/cura-tatuaggio.html',
  '/legal.html',
  '/consultation.html',
  '/session.html',
  '/pre-session.html',
  '/consent.html',
  '/voucher.html',
  '/offline.html',
  '/css/style.css',
  '/css/admin-dashboard.css',
  '/js/main.js',
  '/js/supabase-client.js',
  '/js/auth-guard.js',
  '/js/dashboard.js',
  '/js/admin-dashboard.js',
  '/js/chat-widget.js',
  '/js/consulenza.js',
  '/js/seduta.js',
  '/js/preseduta.js',
  '/js/consenso.js',
  '/js/voucher.js',
  '/js/holidays.js',
  '/js/comuni-it.js',
  '/js/animations.js',
  '/js/dashboard-animations.js',
  '/js/admin-animations.js',
  '/js/push-config.js',
  '/css/animations.css',
  '/favicon.svg',
  '/LOGO.svg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.json'
];

// File da non cachare mai (dati dinamici)
const NEVER_CACHE = [
  'supabase.co',
  'supabase.in',
  'googleapis.com/identitytoolkit',
  'n8n',
  'webhook'
];

// ---- INSTALL: precache shell ----
self.addEventListener('install', (event) => {
  console.log('[SW] Install - v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => {
        // Usa addAll con fallback individuale per evitare che un 404 blocchi tutto
        return Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Precache skip:', url, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting()) // Attiva subito senza aspettare
  );
});

// ---- ACTIVATE: pulisce cache vecchie ----
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate - v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim()) // Prende controllo di tutte le tab
  );
});

// ---- FETCH: strategia di cache ----
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora richieste non-GET
  if (request.method !== 'GET') return;

  // Non cachare chiamate API / Supabase / webhook
  if (NEVER_CACHE.some((pattern) => request.url.includes(pattern))) {
    return; // Lascia passare al network senza intercettare
  }

  // Chrome extensions, blob URLs, etc.
  if (!url.protocol.startsWith('http')) return;

  // Navigazione HTML -> Network first, fallback cache, fallback offline
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Salva in cache dinamica
          const clone = response.clone();
          caches.open(CACHE_DYNAMIC).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then((cached) => cached || caches.match('/offline.html'));
        })
    );
    return;
  }

  // Immagini -> Cache first, poi network
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_IMAGES).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // CSS/JS/Font -> Cache first (shell), poi network con update
  event.respondWith(
    caches.match(request).then((cached) => {
      // Ritorna cache subito, ma aggiorna in background (stale-while-revalidate)
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_STATIC).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => null);

      return cached || fetchPromise;
    })
  );
});

// ---- Notifica i client quando c'e' un aggiornamento ----
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ---- PUSH NOTIFICATIONS ----
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = {
      title: 'Irene Gipsy Tattoo',
      body: event.data.text(),
      icon: '/icons/icon-192x192.png'
    };
  }

  const title = payload.title || 'Irene Gipsy Tattoo';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: '/icons/badge-96x96.png',
    tag: payload.tag || 'igt-notification',
    renotify: !!payload.renotify,
    data: {
      url: payload.url || '/dashboard.html',
      type: payload.type || 'general'
    },
    vibrate: [200, 100, 200],
    actions: payload.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ---- NOTIFICATION CLICK ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/dashboard.html';

  // Se c'e' un'azione specifica
  if (event.action === 'open') {
    // default: apri la URL
  } else if (event.action === 'dismiss') {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se una tab e' gia' aperta, focalizzala e naviga
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Altrimenti apri una nuova tab
      return clients.openWindow(targetUrl);
    })
  );
});
