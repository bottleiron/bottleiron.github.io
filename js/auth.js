/**
 * auth.js
 * Handles PIN validation and AES decryption of the stored credentials.
 */

const auth = {
    currentPin: "",
    maxPinLength: 4,

    /**
     * 입력을 한 자리씩 받습니다.
     */
    inputNum(num) {
        if (this.currentPin.length < this.maxPinLength) {
            this.currentPin += num;
            this.updateDots();
            this.clearError();

            if (this.currentPin.length === this.maxPinLength) {
                // 약간의 딜레이를 주어 마지막 점이 채워지는 것을 보여줌
                setTimeout(() => this.attemptLogin(), 100);
            }
        }
    },

    /**
     * 마지막 입력 지우기
     */
    deleteNum() {
        if (this.currentPin.length > 0) {
            this.currentPin = this.currentPin.slice(0, -1);
            this.updateDots();
            this.clearError();
        }
    },

    /**
     * 전체 입력 초가화
     */
    clearParams() {
        this.currentPin = "";
        this.updateDots();
        this.clearError();
    },

    /**
     * UI 업데이트 (PIN dots)
     */
    updateDots() {
        for (let i = 1; i <= this.maxPinLength; i++) {
            const dot = document.getElementById(`dot-${i}`);
            if (i <= this.currentPin.length) {
                dot.classList.add("filled");
            } else {
                dot.classList.remove("filled");
            }
        }
    },

    showError(msg) {
        document.getElementById('auth-error').textContent = msg;
        // 실패 시 PIN 초기화
        setTimeout(() => this.clearParams(), 500);
    },

    clearError() {
        document.getElementById('auth-error').textContent = "";
    },

    /**
     * Initial Key Setup
     */
    setupKeys() {
        const gemini = document.getElementById('setup-gemini-key').value.trim();
        const github = document.getElementById('setup-github-pat').value.trim();
        const pin = document.getElementById('setup-pin').value.trim();
        const errorEl = document.getElementById('setup-error');

        if (!gemini || !github || !pin) {
            errorEl.textContent = '모든 항목을 입력해주세요.';
            return;
        }

        if (pin.length !== this.maxPinLength || isNaN(pin)) {
            errorEl.textContent = `PIN은 숫자 ${this.maxPinLength}자리여야 합니다.`;
            return;
        }

        errorEl.textContent = '';

        try {
            // Encrypt and save to localStorage
            const encGemini = CryptoJS.AES.encrypt(gemini, pin).toString();
            const encGithub = CryptoJS.AES.encrypt(github, pin).toString();

            localStorage.setItem('encryptedGemini', encGemini);
            localStorage.setItem('encryptedGithub', encGithub);

            // Save decrypted to sessionStorage for immediate use
            sessionStorage.setItem('geminiKey', gemini);
            sessionStorage.setItem('githubPat', github);

            this.switchScreen('user-select-screen');
        } catch (e) {
            console.error(e);
            errorEl.textContent = '키 저장 중 오류가 발생했습니다.';
        }
    },

    /**
     * PWA 환경에서 붙여넣은 공유 URL 파싱
     */
    importShareUrl() {
        const urlInput = document.getElementById('setup-share-url').value.trim();
        const errorEl = document.getElementById('setup-error');

        if (!urlInput) {
            errorEl.textContent = '공유 링크를 먼저 붙여넣어주세요.';
            return;
        }

        try {
            // URL 문자열인지 확인 후 파싱
            const url = new URL(urlInput);
            const importG = url.searchParams.get('g');
            const importH = url.searchParams.get('h');

            if (importG && importH) {
                localStorage.setItem('encryptedGemini', importG);
                localStorage.setItem('encryptedGithub', importH);
                alert("키가 저장되었습니다. 암호화할 때 쓰신 4자리 숫자 PIN을 입력해 로그인을 완료하세요.");

                // 설정 화면 폼 닫고 락 스크린으로 보내기
                document.getElementById('setup-share-url').value = '';
                this.switchScreen('lock-screen');
            } else {
                errorEl.textContent = '올바른 공유 링크 형식이 아닙니다 (키 누락).';
            }
        } catch (e) {
            errorEl.textContent = '유효한 웹 주소(URL) 형식이 아닙니다.';
        }
    },

    /**
     * 복호화 시도 및 로그인 처리
     */
    attemptLogin() {
        const encGemini = localStorage.getItem('encryptedGemini');
        const encGithub = localStorage.getItem('encryptedGithub');

        if (!encGemini || !encGithub) {
            this.showError("등록된 API 키가 없습니다. 앱 데이터 초기화 후 다시 설정하세요.");
            return;
        }

        try {
            // 복호화 시도
            const decryptedGemini = CryptoJS.AES.decrypt(encGemini, this.currentPin).toString(CryptoJS.enc.Utf8);
            const decryptedGithub = CryptoJS.AES.decrypt(encGithub, this.currentPin).toString(CryptoJS.enc.Utf8);

            if (!decryptedGemini || !decryptedGithub) {
                throw new Error("Invalid PIN");
            }

            // 복호화 성공 -> 세션 스토리지에 임시 저장
            sessionStorage.setItem("geminiKey", decryptedGemini);
            sessionStorage.setItem("githubPat", decryptedGithub);

            this.switchScreen('user-select-screen');

        } catch (e) {
            console.error(e);
            this.showError("PIN 번호가 틀렸습니다.");
        }
    },

    logout() {
        sessionStorage.removeItem("geminiKey");
        sessionStorage.removeItem("githubPat");
        sessionStorage.removeItem("currentUser");
        this.clearParams();
        this.switchScreen('lock-screen');
    },

    resetApp() {
        if (confirm("저장된 API 키와 PIN 설정이 모두 삭제됩니다. 계속하시겠습니까?")) {
            localStorage.removeItem('encryptedGemini');
            localStorage.removeItem('encryptedGithub');
            sessionStorage.clear();
            this.clearParams();
            this.switchScreen('setup-screen');
        }
    },

    selectUser(userName) {
        sessionStorage.setItem("currentUser", userName);
        this.switchScreen('chat-screen');
        if (typeof app !== 'undefined' && typeof app.init === 'function') {
            app.init();
        }
    },

    copyShareUrl() {
        const encG = localStorage.getItem('encryptedGemini');
        const encH = localStorage.getItem('encryptedGithub');
        if (!encG || !encH) {
            alert("저장된 키가 없습니다. 먼저 초기 설정을 완료해주세요.");
            return;
        }

        // Construct URL
        const shareUrl = `${window.location.origin}${window.location.pathname}?g=${encodeURIComponent(encG)}&h=${encodeURIComponent(encH)}`;

        // Copy to clipboard
        navigator.clipboard.writeText(shareUrl).then(() => {
            alert("기기 연결 링크가 복사되었습니다!\n\n카카오톡 '나에게 보내기' 등에 붙여넣기 하신 뒤,\n새로운 기기에서 해당 링크를 클릭하시면 즉시 설정이 연동됩니다.");
        }).catch(err => {
            console.error("복사 실패", err);
            prompt("아래 링크를 복사하여 다른 기기로 전송하세요:", shareUrl);
        });
    },

    switchScreen(screenId) {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    },

    // 초기 실행 시 이미 세션이 있으면 통과
    checkSession() {
        const urlParams = new URLSearchParams(window.location.search);
        const importG = urlParams.get('g');
        const importH = urlParams.get('h');

        if (importG && importH) {
            if (confirm("공유받은 API 키 설정을 이 기기에 적용할까요?")) {
                localStorage.setItem('encryptedGemini', importG);
                localStorage.setItem('encryptedGithub', importH);
                alert("키가 임시 저장되었습니다. 암호화할 때 사용한 6자리 PIN을 입력하여 로그인을 완료해주세요.\n(주의: 완료 후 주소창의 긴 URL은 지워주세요!)");
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }

        const encGemini = localStorage.getItem('encryptedGemini');
        const encGithub = localStorage.getItem('encryptedGithub');

        if (!encGemini || !encGithub) {
            // No keys setup yet
            this.switchScreen('setup-screen');
            return;
        }

        if (sessionStorage.getItem("geminiKey") && sessionStorage.getItem("githubPat")) {
            if (sessionStorage.getItem("currentUser")) {
                this.switchScreen('chat-screen');
                if (typeof app !== 'undefined' && typeof app.init === 'function') {
                    app.init();
                }
            } else {
                this.switchScreen('user-select-screen');
            }
        } else {
            // Need PIN to decrypt
            this.switchScreen('lock-screen');
        }
    }
};

// 앱 로드 시 세션 체크
window.addEventListener('DOMContentLoaded', () => {
    auth.checkSession();
});
