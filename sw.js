const CACHE = 'mbps-v22';
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
  // Stale-while-revalidate for the movie API: show a cached catalog immediately
  // on repeat visits, while quietly refreshing it in the background.
  if (url.hostname.includes('accel.li') || url.pathname.includes('list_movies') || url.pathname.includes('movie_details')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }
  if (e.request.method !== 'GET') return;

  // Only cache http/https requests to avoid "chrome-extension" errors
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => cached))
  );
});
