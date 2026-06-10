const CACHE = 'mirage-dubai-v2';
const SHELL = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './vendor/three.module.js',
  './src/main.js', './src/constants.js', './src/state.js', './src/geom.js',
  './src/terrain.js', './src/buildings.js', './src/roads.js', './src/traffic.js',
  './src/simulation.js', './src/effects.js', './src/input.js', './src/ui.js',
  './icons/icon-180.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
    )
  );
});
