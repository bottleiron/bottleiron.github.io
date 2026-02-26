/**
 * auth.js
 * Handles PIN validation and AES decryption of the stored credentials.
 */

const auth = {
    // ---- 여기에 암호화된 토큰을 넣으세요 ----
    // `encrypt.html` 에서 생성한 값을 복사해서 붙여넣습니다.
    ENCRYPTED_GEMINI_KEY: "U2FsdGVkX184KfQcMR3sQr07uXsTDf7L/8xucxow82dZ41soXsV8pMwuDvz/ffEAX3pcgZb0XW9EYTK55ua5aQ==",
    ENCRYPTED_GITHUB_PAT: "U2FsdGVkX1+57q6c5G7/z9alkzK7DWRIxkVrBxTHuBz8Zcy4CuR7c4Bk22w8LgykJglvJeI1Ei76t4hxRFdEFrDxU/X+DUrZHswRpIl/EdtZGU2vCqD36DLfpJiWmjl+R3qsO3Bib6PeXLh2vVZZ4Q==",
    // ------------------------------------

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

            this.switchScreen('chat-screen');
            // 채팅창 로드 완료 후 app.js 내 필요한 초기화 콜백 호출
            if (typeof app !== 'undefined' && typeof app.init === 'function') {
                app.init();
            }

        } catch (e) {
            console.error(e);
            this.showError("PIN 번호가 틀렸습니다.");
        }
    },

    logout() {
        sessionStorage.removeItem("geminiKey");
        sessionStorage.removeItem("githubPat");
        this.clearParams();
        this.switchScreen('lock-screen');
    },

    switchScreen(screenId) {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    },

    // 초기 실행 시 이미 세션이 있으면 통과
    checkSession() {
        if (sessionStorage.getItem("geminiKey") && sessionStorage.getItem("githubPat")) {
            this.switchScreen('chat-screen');
            if (typeof app !== 'undefined' && typeof app.init === 'function') {
                app.init();
            }
        }
    }
};

// 앱 로드 시 세션 체크
window.addEventListener('DOMContentLoaded', () => {
    auth.checkSession();
});
