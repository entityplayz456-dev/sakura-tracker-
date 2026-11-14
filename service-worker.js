/* Caches only the app shell. Your records live in IndexedDB, which this file never touches. */
const PREFIX = 'sakura-';
const VERSION = PREFIX + 'v2';
const SHELL = ['./', 'index.html', 'style.css', 'db.js', 'app.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // Only delete OUR old caches — other apps on the same github.io domain keep theirs.
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Pages: network first so code updates from GitHub show up; fall back to cache when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const c = res.clone(); caches.open(VERSION).then((k) => k.put('index.html', c)); return res; })
      .catch(() => caches.match('index.html')));
    return;
  }
  // Files: serve from cache instantly, refresh the cache in the background.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) { const c = res.clone(); caches.open(VERSION).then((k) => k.put(req, c)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
