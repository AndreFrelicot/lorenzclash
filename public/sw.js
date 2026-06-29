// Service worker — its primary job is to make Lorenz Clash installable as a real PWA.
// Android Chrome only offers "Install" + a standalone/fullscreen launch (instead of a plain
// home-screen shortcut that reopens in the browser) when a service worker with a fetch
// handler is registered on a secure origin. It also gives a basic offline launch by caching
// the app shell + the hashed build assets.
//
// Dev-safe: navigations are network-first, and it only caches content-hashed files under
// /assets/ — Vite's dev modules live under /src, /@vite, /node_modules, so HMR is never
// intercepted and never goes stale.

const CACHE = 'lorenz-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192x192.png',
  '/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  // allSettled (not addAll): a single asset hiccup must NOT reject the install — otherwise
  // the worker never activates and the app stays non-installable.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // analytics / future CDN: leave untouched

  // The HTML document: network-first so updates show immediately, cached shell as the
  // offline fallback. (Network-first also keeps Vite's dev navigations fresh.)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r ?? caches.match('/'))),
    );
    return;
  }

  // Hashed build assets only (content-addressed → safe to cache forever). These paths don't
  // exist under Vite dev, so dev modules/HMR are never intercepted.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (audio, dev modules, etc.): straight to the network.
});
