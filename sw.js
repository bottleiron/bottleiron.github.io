const CACHE_NAME = 'sugar-gebu-v24';

// App Shell Resources (정적 파일)
const URLS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/js/app.js',
    '/js/auth.js',
    '/js/github-api.js',
    '/js/constants.js',
    '/js/api/gemini.js',
    '/js/core/store.js',
    '/js/core/idb-helper.js',
    '/js/ui/renderer.js',
    '/manifest.json',
    '/assets/fontawesome/css/all.min.css',
    '/assets/fontawesome/webfonts/fa-solid-900.woff2',
    '/assets/fontawesome/webfonts/fa-regular-400.woff2',
    '/assets/fontawesome/webfonts/fa-brands-400.woff2'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(URLS_TO_CACHE);
        })
    );
});

// Activate Event: Cleanup old caches and claim clients
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // Claim clients immediately
            self.clients.claim(),
            // Delete old caches
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Service Worker: Clearing Old Cache');
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
        ])
    );
});

self.addEventListener('fetch', event => {
    // 0. HTTP 통신이 아닌 요청(크롬 익스텐션 등 chrome-extension://)은 캐시 스토리지 에러 유발 방지
    if (!event.request.url.startsWith('http')) {
        return;
    }

    // 1. GitHub API Call bypassing (Network Only)
    if (event.request.url.includes('api.github.com') ||
        event.request.url.includes('generativelanguage.googleapis.com')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // 2. ESM.sh Bypassing (External CDN - Cache First)
    if (event.request.url.includes('esm.sh')) {
        event.respondWith(
            caches.match(event.request).then(response => {
                return response || fetch(event.request).then(fetchRes => {
                    return caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, fetchRes.clone());
                        return fetchRes;
                    });
                });
            })
        );
        return;
    }

    // 3. App Shell (Stale-While-Revalidate)
    // 캐시된 버전을 빠르게 먼저 보여주고, 백그라운드에서 네트워크를 통해 캐시를 갱신합니다.
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const fetchPromise = fetch(event.request).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(err => {
                console.warn('Network fetch failed during stale-while-revalidate:', err);
                // Return cached response if network fails
            });

            return cachedResponse || fetchPromise;
        })
    );
});

// ==========================================
// Web Push Integration (Native FCM Payload Handling)
// ==========================================

self.addEventListener('push', function(event) {
    if (!event.data) return;
    
    try {
        const payload = event.data.json();
        console.log('[sw.js] Received native push event', payload);

        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                const isFocused = clientList.some(client => client.focused);
                
                if (isFocused) {
                    // App is in foreground, send message to client to show in-app alert
                    clientList.forEach(client => {
                        client.postMessage({
                            type: 'FCM_MESSAGE',
                            payload: payload
                        });
                    });
                } else {
                    // App is in background, show system notification
                    const title = payload.notification?.title || payload.data?.title || '슈가게부 알림';
                    const options = {
                        body: payload.notification?.body || payload.data?.body || '새로운 업데이트가 있습니다.',
                        icon: '/icon.svg',
                        badge: '/icon.svg',
                        data: payload.data
                    };
                    return self.registration.showNotification(title, options);
                }
            })
        );
    } catch (e) {
        console.error('Error handling push event', e);
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return clients.openWindow('/');
        })
    );
});
