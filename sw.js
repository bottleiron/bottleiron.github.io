const CACHE_NAME = 'sugar-gebu-v1';

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
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
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
        })
    );
});

self.addEventListener('fetch', event => {
    // 1. GitHub API Call bypassing (Network Only)
    // 데이터 변경 사항은 실시간으로 반영되어야 하며 잘못 캐싱될 경우 큰 충돌 이슈 야기
    if (event.request.url.includes('api.github.com') ||
        event.request.url.includes('generativelanguage.googleapis.com')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // 2. ESM.sh Bypassing (External CDN)
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

    // 3. App Shell (Cache First, fallback to Network)
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});
