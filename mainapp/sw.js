// Odisha e-Guru — Service Worker
// Version: 1.0
const CACHE = 'eguru-v1';

const FILES = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

// Install — cache essential files
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(cache => {
            return cache.addAll(FILES).catch(err => {
                console.log('Cache addAll error:', err);
            });
        })
    );
    self.skipWaiting();
});

// Activate — remove old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', e => {
    e.respondWith(
        fetch(e.request)
            .then(response => {
                // Cache successful responses
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE).then(cache => {
                        cache.put(e.request, clone);
                    });
                }
                return response;
            })
            .catch(() => {
                // If network fails, serve from cache
                return caches.match(e.request).then(cached => {
                    if (cached) return cached;
                    // If nothing in cache either, return offline message
                    return new Response(
                        `<!DOCTYPE html>
                        <html><head><meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width,initial-scale=1">
                        <title>Offline</title>
                        <style>
                            body{font-family:Arial,sans-serif;display:flex;
                            justify-content:center;align-items:center;
                            min-height:100vh;background:#667eea;margin:0;padding:20px;}
                            .box{background:white;border-radius:16px;padding:40px;
                            text-align:center;max-width:300px;}
                            h2{color:#667eea;margin-bottom:16px;}
                            p{color:#666;margin-bottom:20px;}
                            button{background:#667eea;color:white;border:none;
                            padding:12px 24px;border-radius:8px;font-size:16px;
                            cursor:pointer;}
                        </style></head>
                        <body><div class="box">
                            <h2>🎓 e-Guru</h2>
                            <p>ଇଣ୍ଟର୍ନେଟ୍ ସଂଯୋଗ ନାହିଁ।<br>No internet connection.</p>
                            <button onclick="location.reload()">Try Again</button>
                        </div></body></html>`,
                        { headers: { 'Content-Type': 'text/html' } }
                    );
                });
            })
    );
});
