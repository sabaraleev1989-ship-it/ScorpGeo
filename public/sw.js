// Service Worker для ScorpGEO
const CACHE_NAME = 'scorpgeo-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    console.log('📱 ScorpGEO SW: Установка');
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('📦 ScorpGEO SW: Кеширование');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', (event) => {
    console.log('📱 ScorpGEO SW: Активирован');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            );
        })
    );
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('socket.io') || event.request.url.includes('/api/')) return;
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

setInterval(() => {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'KEEP_ALIVE', timestamp: Date.now() }));
    });
}, 20000);

console.log('📱 ScorpGEO SW: Готов');
