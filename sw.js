const CACHE = 'mis-niditos-v26';
const ASSETS = [
  '/apt-hunter/',
  '/apt-hunter/index.html',
  '/apt-hunter/css/styles.css',
  '/apt-hunter/src/app.js',
  '/apt-hunter/src/ui.js',
  '/apt-hunter/src/router.js',
  '/apt-hunter/src/services.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Cache-first for same-origin GETs only. Cross-origin requests (Supabase,
  // GitHub, Cloudflare worker, esm.sh) and non-GETs pass through to the
  // network — re-issuing them from the SW context can throw "Failed to fetch".
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
