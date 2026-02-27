const CACHE_NAME = 'sugar-gebu-v3';

// App Shell Resources (정적 파일)
const URLS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/js/app.js',
    '/js/auth.js',
    '/js/github-api.js',
    '/manifest.json'
];

self.addEventListener('install', event => {
    // 새 서비스워커가 바로 설치되도록 대기 중단
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache v3');
                return cache.addAll(URLS_TO_CACHE);
            })
    );
});

self.addEventListener('activate', event => {
    const cacheAllowlist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheAllowlist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // 즉시 제어권 확보
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

    // 3. App Shell (Network First)
    // 항상 최신 코드를 사용자에게 먼저 시도하고, 오프라인이거나 실패 시 기존 캐시 사용
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // Check if response is valid to be cached
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    // type !== 'basic' usually means opaque responses, but html/css in same origin are basic.
                    return networkResponse;
                }

                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});
