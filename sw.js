// Offline service worker.
// App files: served from cache instantly, refreshed in the background (stale-while-revalidate).
// On localhost we go network-first so edits show up without cache busting.
// Bump VERSION when shipping changes so old caches are cleared.
const VERSION = 'lm-v2';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/store.js',
  'js/sync.js',
  'js/config.js',
  'js/model.js',
  'js/views.js',
  'js/sheet.js',
  'js/util.js',
  'js/icons.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache Supabase API / auth / realtime traffic.
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;

  const sameOrigin = url.origin === self.location.origin;
  const cdn = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !cdn) return;

  // Navigations fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  if (sameOrigin && DEV) {
    e.respondWith(fetch(req).then((res) => { putCache(req, res.clone()); return res; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((res) => { putCache(req, res.clone()); return res; }).catch(() => cached);
      return cached || fresh;
    }),
  );
});

function putCache(req, res) {
  if (res && (res.ok || res.type === 'opaque')) caches.open(VERSION).then((c) => c.put(req, res));
}
