const CACHE_NAME = 'evidya-home-cache-v2';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        urlsToCache.map(url =>
          cache.add(url).catch(err => console.log('Failed to cache:', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    (async () => {
      try {
        // Rebuild the request forcing redirect: 'follow' to avoid
        // "redirected response used for request whose redirect mode is not follow"
        const req = new Request(event.request.url, {
          method: event.request.method,
          headers: event.request.headers,
          mode: event.request.mode === 'navigate' ? 'same-origin' : event.request.mode,
          credentials: event.request.credentials,
          redirect: 'follow'
        });
        return await fetch(req);
      } catch (err) {
        const cached = await caches.match(event.request);
        return cached || Response.error();
      }
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      )
    )
  );
  self.clients.claim();
});
