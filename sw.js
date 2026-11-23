import { bildirimMetni, bugun } from './core.js';

// Önce ağ, ağ yoksa önbellek: güncellemeler kendiliğinden gelir, internetsizken son sürüm çalışır.
const C = 'vade';
const F = ['./', './index.html', './app.js', './core.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(F)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(
  fetch(e.request, { cache: 'no-cache' })
    .then(r => { if (r.ok) { const k = r.clone(); caches.open(C).then(c => c.put(e.request, k)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }))));

// ---- Hatırlatma bildirimi: günde en fazla bir kez ----
const dbAc = () => new Promise((ok, err) => {
  const r = indexedDB.open('vade', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => err(r.error);
});
const kv = (db, mod, f) => new Promise((ok, err) => {
  const t = db.transaction('kv', mod), q = f(t.objectStore('kv'));
  t.oncomplete = () => ok(q.result);
  t.onerror = () => err(t.error);
});

async function hatirlat(test = false) {
  const db = await dbAc();
  const S = await kv(db, 'readonly', s => s.get('state'));
  if (!S?.bildirim) return;
  if (!test && (await kv(db, 'readonly', s => s.get('sonBildirim'))) === bugun()) return;
  const b = bildirimMetni(S.alacaklar, S.bildirim.gun) || (test && { baslik: 'Vade bildirimleri çalışıyor', govde: 'Şu an vadesi gelen ödeme yok.' });
  if (!b) return;
  await self.registration.showNotification(b.baslik, { body: b.govde, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'vade' });
  if (!test) await kv(db, 'readwrite', s => s.put(bugun(), 'sonBildirim'));
}

self.addEventListener('periodicsync', e => { if (e.tag === 'vade-hatirlat') e.waitUntil(hatirlat()); });
self.addEventListener('message', e => e.waitUntil(hatirlat(e.data === 'test')));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => (l[0] ? l[0].focus() : self.clients.openWindow('./#/rapor'))));
});
