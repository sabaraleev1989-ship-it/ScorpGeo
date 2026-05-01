// Service Worker для SCORPION TACTICAL
const CACHE_NAME = 'scorpion-tactical-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
    console.log('📱 SW: Установка');
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('📦 SW: Кеширование ресурсов');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// Активация
self.addEventListener('activate', (event) => {
    console.log('📱 SW: Активирован');
    
    // Удаляем старые кеши
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    
    event.waitUntil(clients.claim());
});

// Перехват запросов (сеть → кеш)
self.addEventListener('fetch', (event) => {
    // Пропускаем Socket.io и API запросы
    if (event.request.url.includes('socket.io') || 
        event.request.url.includes('/api/')) {
        return;
    }
    
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Кешируем успешные ответы
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Офлайн — отдаем из кеша
                return caches.match(event.request);
            })
    );
});

// Фоновый keep-alive каждые 20 секунд
setInterval(() => {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ 
                type: 'KEEP_ALIVE', 
                timestamp: Date.now() 
            });
        });
    });
}, 20000);

console.log('📱 SW: Готов к работе');
