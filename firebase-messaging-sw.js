importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyCdPGXOcbgQAXE7ABo-_exLKGdnNxo3LzQ",
    projectId: "siyucalc",
    messagingSenderId: "873392553373",
    appId: "1:873392553373:web:4538cd1c070ab5e194c374"
});

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
