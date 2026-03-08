import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

const firebaseConfig = {
    apiKey: "AIzaSyCdPGXOcbgQAXE7ABo-_exLKGdnNxo3LzQ",
    authDomain: "siyucalc.firebaseapp.com",
    projectId: "siyucalc",
    storageBucket: "siyucalc.firebasestorage.app",
    messagingSenderId: "873392553373",
    appId: "1:873392553373:web:4538cd1c070ab5e194c374",
    measurementId: "G-HVYLT317J6"
};

const VAPID_KEY = "BKTYiYuN21epqBJu25yzUgbESZD83xCeIynT9BtehrTbShBIIoZyZjRgtbDkl4x76sG6lmbV0PTyuXPKiHGQS3w";

export const fcmApi = {
    app: null,
    messaging: null,

    init() {
        try {
            this.app = initializeApp(firebaseConfig);
            this.messaging = getMessaging(this.app);

            // Listen for foreground messages
            onMessage(this.messaging, (payload) => {
                console.log("Foreground Message received: ", payload);
                if (window.app && window.app.appendMessage) {
                    const title = payload.notification?.title || payload.data?.title || '새로운 알림';
                    const body = payload.notification?.body || payload.data?.body || '';
                    window.app.appendMessage(`🔔 **${title}**<br/>${body}`, 'bot', true);
                }
            });
            console.log("Firebase initialized");
        } catch (error) {
            console.error("Firebase init failed:", error);
            // Don't alert here to avoid annoying users on every load if they just don't want notifications.
            // We save the error so we can show it when they click the bell button.
            this.initError = error;
        }
    },

    async requestPermission(githubApi, currentUser) {
        try {
            if (this.initError) {
                alert("푸시 알림 초기화 실패: " + this.initError.message + "\n\n아이폰은 iOS 16.4 이상이어야 하며, 반드시 사파리에서 '홈 화면에 추가'를 한 앱에서만 동작합니다.");
                return false;
            }
            if (!this.messaging) {
                alert("푸시 알림 모듈이 아직 로드되지 않았습니다. 인터넷 연결을 확인하고 앱을 껐다 켜주세요.");
                return false;
            }

            console.log("Requesting notification permission...");

            if (!('Notification' in window)) {
                alert("이 기기나 브라우저는 푸시 알림을 지원하지 않습니다. (아이폰은 무조건 '홈 화면에 추가' 후 그 아이콘으로 실행해야 합니다!)");
                return false;
            }

            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                console.log("Notification permission granted.");

                // Get token using existing active service worker
                const registration = await navigator.serviceWorker.ready;
                const currentToken = await getToken(this.messaging, {
                    vapidKey: VAPID_KEY,
                    serviceWorkerRegistration: registration
                });
                if (currentToken) {
                    console.log("FCM Token:", currentToken);
                    await this.saveTokenToGithub(currentToken, githubApi, currentUser);
                    alert("푸시 알림 설정이 완료되었습니다! 🎉");
                    return true;
                } else {
                    console.log('No registration token available. Request permission to generate one.');
                    alert("토큰 발급에 실패했습니다. (지원되지 않는 브라우저 또는 환경일 수 있습니다.)");
                    return false;
                }
            } else {
                console.log("Notification permission not granted.");
                alert("알림 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해 주세요.");
                return false;
            }
        } catch (error) {
            console.error('An error occurred while retrieving token. ', error);
            alert("알림 설정 중 오류가 발생했습니다: " + error.message);
            return false;
        }
    },

    async saveTokenToGithub(token, githubApi, currentUser) {
        try {
            let tokensObj = {};
            let currentSha = null;
            try {
                // Try to get existing tokens.json
                const contentData = await githubApi.getFileContent('data/tokens.json');
                if (contentData && contentData.content) {
                    tokensObj = JSON.parse(contentData.content);
                    currentSha = contentData.sha;
                }
            } catch (err) {
                console.log("tokens.json not found or empty, creating new one.");
            }

            tokensObj[currentUser] = token;

            await githubApi.uploadFile('data/tokens.json', JSON.stringify(tokensObj, null, 2), `[skip ci] Update FCM token for ${currentUser}`, currentSha);
            console.log("Token saved to GitHub successfully.");
        } catch (error) {
            console.error("Failed to save token to GitHub:", error);
        }
    }
};
