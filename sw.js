const CACHE = 'mis-niditos-v2';
const ASSETS = [
  '/apt-hunter/',
  '/apt-hunter/index.html',
  '/apt-hunter/css/styles.css',
  '/apt-hunter/src/app.js',
  '/apt-hunter/src/ui.js',
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
  // Network-first for API calls, cache-first for assets
  if (e.request.url.includes('anthropic.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
