const CACHE_NAME = 'sugar-gebu-v17';

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
    '/js/ui/renderer.js',
    '/manifest.json',
    '/assets/fontawesome/css/all.min.css',
    '/assets/fontawesome/webfonts/fa-solid-900.woff2',
    '/assets/fontawesome/webfonts/fa-regular-400.woff2',
    '/assets/fontawesome/webfonts/fa-brands-400.woff2'
];

self.addEventListener('install', event => {
    // 새 서비스워커가 바로 설치되도록 대기 중단
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache', CACHE_NAME);
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
