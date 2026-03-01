/**
 * auth.js
 * Handles PIN validation and AES decryption of the stored credentials.
 */

const auth = {
    // ---- 여기에 암호화된 토큰을 넣으세요 ----
    // `encrypt.html` 에서 생성한 값을 복사해서 붙여넣습니다.
    ENCRYPTED_GEMINI_KEY: "U2FsdGVkX18lfQx0pUA4E8ySt+SOxMfUiJsGgDugFkG/5tH78zEEv6m59uyYrz/R37L39TBSMzbooEge1nTQ+g==",
    ENCRYPTED_GITHUB_PAT: "U2FsdGVkX19eiCf+EHXzZTFJ/zh/Jaytuz3h0p6TNHbXNNMsBK4j1PTeoZt7s42Uv8wRMwhDeMVquvG5FURxzLMG9kKj66ay7kXMVPNtT6EMMVxD/OqgsN6oRnveLtyMe5aYuy0Lp2PkmpNFkIPKgw==",
    // ------------------------------------

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
     * 복호화 시도 및 로그인 처리
     */
    attemptLogin() {
        if (this.ENCRYPTED_GEMINI_KEY === "여기에_암호화된_제미나이키_붙여넣기") {
            this.showError("auth.js에 암호화된 키를 먼저 설정해주세요.");
            return;
        }

        try {
            // 복호화 시도
            const decryptedGemini = CryptoJS.AES.decrypt(this.ENCRYPTED_GEMINI_KEY, this.currentPin).toString(CryptoJS.enc.Utf8);
            const decryptedGithub = CryptoJS.AES.decrypt(this.ENCRYPTED_GITHUB_PAT, this.currentPin).toString(CryptoJS.enc.Utf8);

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
        if (sessionStorage.getItem("geminiKey") && sessionStorage.getItem("githubPat")) {
            if (sessionStorage.getItem("currentUser")) {
                this.switchScreen('chat-screen');
                if (typeof app !== 'undefined' && typeof app.init === 'function') {
                    app.init();
                }
            } else {
                this.switchScreen('user-select-screen');
            }
        }
    }
};

// 앱 로드 시 세션 체크
window.addEventListener('DOMContentLoaded', () => {
    auth.checkSession();
});
