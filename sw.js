// Önce ağ, ağ yoksa önbellek: güncellemeler kendiliğinden gelir, internetsizken son sürüm çalışır.
const C = 'vade';
const F = ['./', './index.html', './app.js', './core.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(F)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(
  fetch(e.request, { cache: 'no-cache' })
    .then(r => { if (r.ok) { const k = r.clone(); caches.open(C).then(c => c.put(e.request, k)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }))));
