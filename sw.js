// Minimal offline shell. Network-first for app files (so updates land fast),
// cache fallback offline. API calls (OneMap/OSRM/Nominatim) are never cached.
const CACHE = 'gonow-v1';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/engine.js', 'js/geo.js',
  'js/markets/index.js', 'js/markets/sg.js', 'manifest.webmanifest', 'icons/icon.svg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('index.html')))
  );
});
