/**
 * auth.js
 * Handles PIN validation and AES decryption of the stored credentials.
 */

const auth = {
    currentPin: "",
    maxPinLength: 6,

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

    switchScreen(screenId) {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    },

    // 초기 실행 시 이미 세션이 있으면 통과
    checkSession() {
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
