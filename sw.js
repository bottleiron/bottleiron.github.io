var cacheName = 'hello-pwa';
var filesToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js'
];

/* Start the service worker and cache all of the app's content */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(cacheName).then(function(cache) {
      return cache.addAll(filesToCache);
    })
  );
});

/* Serve cached content when offline */
self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.match(e.request).then(function(response) {
      return response || fetch(e.request);
    })
  );
});

//푸시처리부분

//Push Message 수신 이벤트
self.addEventListener('push', function (event)
{
    console.log('[ServiceWorker] 푸시알림 수신: ', event);

    console.log(event.data.json())
    console.log(event.data.text())
    //Push 정보 조회
    var title = event.data.data.title || 'test';
    var body = event.data.data.body;
    var icon = event.data.icon || 'images/hello-icon-512.png'; //512x512
    var badge = event.data.badge || 'images/hello-icon-128.png'; //128x128
    var options = {
        body: body,
        icon: icon,
        badge: badge
    };
 
    //Notification 출력
    event.waitUntil(self.registration.showNotification(title, options));
});
 
//사용자가 Notification을 클릭했을 때
self.addEventListener('notificationclick', function (event)
{
    console.log('[ServiceWorker] 푸시알림 클릭: ', event);
 
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: "window" })
            .then(function (clientList)
            {
                //실행된 브라우저가 있으면 Focus
                for (var i = 0; i < clientList.length; i++)
                {
                    var client = clientList[i];
                    if (client.url == '/' && 'focus' in client)
                        return client.focus();
                }
                //실행된 브라우저가 없으면 Open
                if (clients.openWindow)
                    return clients.openWindow('https://bottleiron.github.io');
            })
    );
});