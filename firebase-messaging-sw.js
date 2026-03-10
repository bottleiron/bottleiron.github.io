importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');
importScripts('js/core/idb-helper.js');

// Initialize Firebase only after config is retrieved from IndexedDB
async function initFirebase() {
    try {
        const config = await idbHelper.get('firebase_config');
        if (config) {
            firebase.initializeApp(config);
            const messaging = firebase.messaging();

            messaging.onBackgroundMessage((payload) => {
                console.log('[firebase-messaging-sw.js] Received background message ', payload);
                if (payload.notification) {
                    return;
                }

                const notificationTitle = payload.data?.title || '슈가게부 알림';
                const notificationOptions = {
                    body: payload.data?.body || '새로운 업데이트가 있습니다.',
                    icon: '/icon.svg',
                    badge: '/icon.svg'
                };

                self.registration.showNotification(notificationTitle, notificationOptions);
            });
            console.log("Firebase SW initialized with dynamic config");
        } else {
            console.warn("Firebase SW: No config found in IndexedDB yet.");
        }
    } catch (e) {
        console.error("Firebase SW initialization failed:", e);
    }
}

// Start initialization
initFirebase();
