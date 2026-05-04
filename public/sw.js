// =====================================================================
// Razkindo ERP Service Worker v7 — STB Optimized + Push Notifications
//
// Features:
// - Aggressive static asset caching (cache-first strategy)
// - API route passthrough (never cached)
// - Offline fallback page
// - Background cache cleanup on activate
// - Stale-while-revalidate for _next assets
// - Push notification support (VAPID)
// =====================================================================

const CACHE_NAME = 'razkindo-erp-v7';
const OFFLINE_CACHE = 'razkindo-offline-v1';

const STATIC_ASSETS = [
  '/',
  '/logo.svg',
  '/api/pwa/icon?size=192',
  '/api/pwa/icon?size=512',
];

// Install: pre-cache critical static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Non-critical — continue even if some assets fail
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== OFFLINE_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ================================
// PUSH NOTIFICATION HANDLER
// ================================

self.addEventListener('push', (event) => {
  let data = {
    title: 'Razkindo ERP',
    body: 'Notifikasi baru',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {},
    tag: 'default',
    renotify: false,
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      // Use plain text as body
      data.body = event.data.text();
    }
  }

  const options: NotificationOptions = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    data: data.data || {},
    tag: data.tag || 'default',
    renotify: data.renotify || false,
    vibrate: [100, 50, 100], // Vibration pattern
    actions: data.data?.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const urlToOpen = data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(urlToOpen);
    })
  );
});

// Handle notification close (for analytics if needed)
self.addEventListener('notificationclose', (event) => {
  // Could track notification dismissal analytics here
});

// ================================
// OFFLINE FALLBACK PAGE
// ================================
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Offline - Razkindo ERP</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; }
    .container { text-align: center; max-width: 400px; }
    .icon { font-size: 4rem; margin-bottom: 1rem; opacity: 0.5; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
    .btn { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 2rem; background: #0d9488; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; text-decoration: none; }
    .btn:hover { background: #0f766e; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📡</div>
    <h1>Koneksi Terputus</h1>
    <p>Sistem tidak dapat terhubung ke server. Periksa koneksi internet Anda dan coba lagi.</p>
    <button class="btn" onclick="window.location.reload()">Coba Lagi</button>
  </div>
</body>
</html>`;

// ================================
// FETCH HANDLER
// ================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // NEVER cache API requests — always pass through to network
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Static assets (images, fonts, icons): Cache first, revalidate in background
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstWithRevalidate(request));
    return;
  }

  // Next.js static chunks: Cache first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Other _next resources (dynamic chunks): Stale-while-revalidate
  if (url.pathname.startsWith('/_next/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // HTML pages: Network first with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }
});

// ================================
// CACHING STRATEGIES
// ================================

function isStaticAsset(url) {
  const path = url.pathname;
  return (
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.svg') ||
    path.endsWith('.ico') ||
    path.endsWith('.webp') ||
    path.endsWith('.woff') ||
    path.endsWith('.woff2') ||
    path.endsWith('.gif') ||
    path.startsWith('/fonts/')
  );
}

// Cache-first: return from cache, update in background
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

// Cache-first with background revalidation
async function cacheFirstWithRevalidate(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Update cache in background (stale-while-revalidate)
    fetch(request).then((response) => {
      if (response && response.ok) {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
      }
    }).catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

// Stale-while-revalidate: serve cache immediately, update in background
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  }).catch(() => new Response('Offline', { status: 503, statusText: 'Offline' }));

  return cached || fetchPromise;
}

// Network-first with offline fallback
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  } catch {
    // Offline: try to serve cached page
    const cached = await caches.match(request.url);
    if (cached) return cached;

    // Fallback to root for any sub-page
    if (request.url !== self.location.origin + '/') {
      const rootCached = await caches.match('/');
      if (rootCached) return rootCached;
    }

    // Final fallback: offline page
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
