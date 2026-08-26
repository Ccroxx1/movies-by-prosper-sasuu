const CACHE = 'mbps-v21';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icons/logo-header.png', './icons/favicon.ico', './icons/favicon.svg', './icons/icon-192.png', './icons/sprite.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const path = new URL(e.request.url).pathname;
  // Never cache-control crawler files incorrectly
  if (/\/(robots\.txt|ads\.txt|sitemap\.xml)$/.test(path)) {
    e.respondWith(fetch(e.request));
    return;
  }

  const url = new URL(e.request.url);
  // Network-first for API, cache-first for app shell
  if (url.hostname.includes('accel.li') || url.pathname.includes('list_movies') || url.pathname.includes('movie_details')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => cached))
  );
});
