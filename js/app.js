/**
 * app.js
 * Core application logic to handle conversational parsing by Gemini and 
 * reading/writing to GitHub via GithubApi class (No-Build Architecture).
 */

import { v4 as uuidv4 } from "uuid";
import { GithubApi } from "./github-api.js";
import { Solar, Lunar } from "lunar-javascript";

const GITHUB_OWNER = 'bottleiron';
const GITHUB_REPO = 'my-ledger-data';
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

const app = {
    geminiKey: "",
    githubPat: "",
    githubApi: null,
    chatWindow: null,
    userInput: null,
    typingIndicator: null,
    currentDate: new Date(),
    allLedgerData: [], // Contains data for all years/months
    fixedExpenses: [], // Contains monthly fixed expenses rules
    syncQueue: [], // Local unsynced changes
    selectedDate: null, // For modal
    currentUser: "사용자",

    init() {
        this.geminiKey = sessionStorage.getItem("geminiKey");
        this.githubPat = sessionStorage.getItem("githubPat");
        this.currentUser = sessionStorage.getItem("currentUser") || "사용자";

        if (this.githubPat) {
            this.githubApi = new GithubApi(GITHUB_OWNER, GITHUB_REPO, this.githubPat);
        }

        console.log("app.init() called, user:", this.currentUser);
        this.chatWindow = document.getElementById('chat-window');
        this.userInput = document.getElementById('user-input');

        if (!this.userInput || !this.chatWindow) {
            console.log("Elements not found, retrying init...");
            setTimeout(() => this.init(), 50);
            return;
        }
        console.log("Elements found, continuing init");

        // Check if event listener was already added to prevent duplicates on multiple inits
        if (!this._isInitialized) {
            // Setup Enter key to send message
            this.userInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });

            // Initialize typing indicator
            this.typingIndicator = document.createElement('div');
            this.typingIndicator.id = 'typing-indicator';
            this.typingIndicator.innerHTML = '<div class="dot-flashing"></div>';
            this.chatWindow.appendChild(this.typingIndicator);

            // Setup Tab Switching
            document.querySelectorAll('.tab-item').forEach(tab => {
                tab.addEventListener('click', () => {
                    const viewName = tab.getAttribute('data-view');
                    this.switchView(viewName);
                });
            });

            this._isInitialized = true;
            this.loadSyncQueue();
            this.loadData();
        }
    },

    /**
     * Switch between different app views (chat, calendar, stats)
     */
    switchView(viewName) {
        console.log(`Switching view to: ${viewName}`);

        // Update tabs UI
        document.querySelectorAll('.tab-item').forEach(tab => {
            if (tab.getAttribute('data-view') === viewName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Update views visibility
        const views = ['chat', 'calendar', 'stats'];
        views.forEach(v => {
            const el = document.getElementById(`${v}-view`);
            if (el) {
                if (v === viewName) {
                    el.classList.add('view-active');
                    el.classList.remove('view-hidden');
                } else {
                    el.classList.remove('view-active');
                    el.classList.add('view-hidden');
                }
            }
        });
    },

    async loadData() {
        this.showTyping();
        try {
            // 1. Try to load from LocalStorage cache first for instant UX
            const cachedLedger = localStorage.getItem(`cachedAllData_${this.currentUser}`);
            const cachedFixed = localStorage.getItem(`cachedFixed_${this.currentUser}`);

            if (cachedLedger) {
                this.allLedgerData = JSON.parse(cachedLedger);
            }
            if (cachedFixed) {
                this.fixedExpenses = JSON.parse(cachedFixed);
            }

            this.mergeQueueToLedger();
            this.updateDashboard();
            this.renderCalendar();
            this.renderStats();

            // 2. Fetch all data from GitHub in JS background
            if (this.githubApi) {
                // To avoid Rate Limit, we might only fetch if it's been a while
                const freshData = await this.githubApi.fetchAllData();
                this.allLedgerData = freshData;
                localStorage.setItem(`cachedAllData_${this.currentUser}`, JSON.stringify(freshData));

                const freshFixed = await this.githubApi.getFixedExpenses();
                this.fixedExpenses = freshFixed;
                localStorage.setItem(`cachedFixed_${this.currentUser}`, JSON.stringify(freshFixed));

                this.mergeQueueToLedger();
                this.updateDashboard();
                this.renderCalendar();
                this.renderStats();
            }

        } catch (error) {
            console.error("Failed to load data:", error);
            this.mergeQueueToLedger();
            this.updateDashboard();
            this.renderCalendar();
            this.renderStats();
        } finally {
            this.hideTyping();
        }
    },

    updateDashboard() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth() + 1;
        const prefix = `${year}-${String(month).padStart(2, '0')}`;

        const total = this.allLedgerData.reduce((sum, item) => {
            if (item.date && item.date.startsWith(prefix)) {
                return sum + Number(item.amount);
            }
            return sum;
        }, 0);

        const monthLabel = document.querySelector('.month-label');
        const amountLabel = document.querySelector('.total-amount');
        if (monthLabel) monthLabel.textContent = `${year}년 ${month}월`;
        if (amountLabel) amountLabel.textContent = `₩ ${total.toLocaleString()}`;
    },

    changeMonth(delta) {
        this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        this.updateDashboard();
        this.renderCalendar();
        this.renderStats();
    },

    renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth() + 1;

        const label = document.getElementById('calendar-month-label');
        if (label) label.textContent = `${year}년 ${month}월`;

        const grid = document.getElementById('calendar-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const firstDay = new Date(year, month - 1, 1).getDay();
        const daysInMonth = new Date(year, month, 0).getDate();

        const today = new Date();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month - 1;

        const dailyTotals = {};
        this.allLedgerData.forEach(item => {
            if (item.date && item.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
                const day = parseInt(item.date.split('-')[2], 10);
                dailyTotals[day] = (dailyTotals[day] || 0) + Number(item.amount);
            }
        });

        // Anniversaries definition
        const ANNIVERSARIES = [
            { type: 'solar', m: 2, d: 1, icon: '💍', label: '결혼기념일' },
            { type: 'solar', m: 9, d: 22, icon: '👱‍♂️', label: '남편 생일' },
            { type: 'solar', m: 10, d: 8, icon: '👩', label: '아내 생일' },
            { type: 'lunar', m: 2, d: 22, icon: '👵', label: '처가 장모님 생신' },
            { type: 'lunar', m: 4, d: 4, icon: '👴', label: '본가 아버님 생신' },
            { type: 'lunar', m: 11, d: 21, icon: '👵', label: '본가 어머님 생신' }
        ];

        const dailyAnniversaries = {};
        for (let day = 1; day <= daysInMonth; day++) {
            const matches = [];
            // Check Solar
            matches.push(...ANNIVERSARIES.filter(a => a.type === 'solar' && a.m === month && a.d === day));
            // Check Lunar
            try {
                const solarObj = Solar.fromYmd(year, month, day);
                const lunarObj = solarObj.getLunar();
                matches.push(...ANNIVERSARIES.filter(a => a.type === 'lunar' && a.m === Math.abs(lunarObj.getMonth()) && a.d === lunarObj.getDay()));
            } catch (e) {
                console.warn('Lunar conversion skipped for day', day);
            }

            if (matches.length > 0) {
                dailyAnniversaries[day] = matches;
            }
        }

        for (let i = 0; i < firstDay; i++) {
            grid.innerHTML += `<div class="cal-day empty"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = isCurrentMonth && day === today.getDate() ? 'today' : '';
            const amountHtml = dailyTotals[day] ? `<div class="cal-amount">${dailyTotals[day].toLocaleString()}</div>` : '';

            let anniversaryHtml = '';
            if (dailyAnniversaries[day]) {
                const icons = dailyAnniversaries[day].map(a => `<span title="${a.label}">${a.icon}</span>`).join('');
                anniversaryHtml = `<div class="cal-anniversary">${icons}</div>`;
            }

            // apply inline relative position for absolute marking
            grid.innerHTML += `
                <div class="cal-day ${isToday}" style="position:relative;" onclick="app.openDayModal(${year}, ${month}, ${day})">
                    <div class="cal-date">${day}</div>
                    ${anniversaryHtml}
                    ${amountHtml}
                </div>
            `;
        }

        // Render fixed expenses widget
        this.renderFixedExpenses(year, month);
    },

    renderStats() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth() + 1;

        const categoryTotals = {};
        let totalMonth = 0;

        this.allLedgerData.forEach(item => {
            if (item.date && item.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
                const cat = item.category || '기타';
                categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(item.amount);
                totalMonth += Number(item.amount);
            }
        });

        const chartContainer = document.getElementById('stats-chart');
        const listContainer = document.getElementById('stats-list');
        if (!chartContainer || !listContainer) return;

        chartContainer.innerHTML = '';
        listContainer.innerHTML = '';

        if (totalMonth === 0) {
            chartContainer.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;">지출 내역이 없습니다.</div>';
            return;
        }

        const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

        sortedCategories.forEach(([cat, amount]) => {
            const percentage = ((amount / totalMonth) * 100).toFixed(1);

            chartContainer.innerHTML += `
                <div class="stat-bar-container">
                    <div class="stat-info">
                        <span>${cat}</span>
                        <span>${percentage}%</span>
                    </div>
                    <div class="stat-bar-bg">
                        <div class="stat-bar-fill" style="width: ${percentage}%"></div>
                    </div>
                </div>
            `;

            listContainer.innerHTML += `
                <div class="stat-item">
                    <span class="stat-cat">${cat}</span>
                    <span class="stat-amt">₩ ${amount.toLocaleString()}</span>
                </div>
            `;
        });
    },

    // ==========================================
    // MODAL LOGIC (DAY DETAILS)
    // ==========================================

    openDayModal(year, month, day) {
        this.selectedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const titleLabel = document.getElementById('modal-date-title');
        if (titleLabel) titleLabel.textContent = `${year}년 ${month}월 ${day}일`;

        this.renderModalExpenses();

        const modal = document.getElementById('day-modal');
        if (modal) modal.classList.add('show');
    },

    closeDayModal() {
        const modal = document.getElementById('day-modal');
        if (modal) modal.classList.remove('show');

        // Reset form inputs
        document.getElementById('add-place').value = '';
        document.getElementById('add-amount').value = '';
        document.getElementById('add-category').value = '식비';
    },

    renderModalExpenses() {
        const listDiv = document.getElementById('modal-expense-list');
        listDiv.innerHTML = '';

        // Filter items for the selected date
        // Since we now use UUID, no need for _origIdx map
        const dayItems = this.allLedgerData.filter(item => item.date === this.selectedDate);

        if (dayItems.length === 0) {
            listDiv.innerHTML = '<div class="empty-msg">이날의 지출 내역이 없습니다.</div>';
            return;
        }

        dayItems.forEach(item => {
            const formatedAmt = new Intl.NumberFormat('ko-KR').format(item.amount);
            listDiv.innerHTML += `
                <div class="expense-item">
                    <div class="expense-info">
                        <span class="expense-place">${item.place}</span>
                        <span class="expense-cat">${item.category || '기타'}</span>
                    </div>
                    <div class="expense-right">
                        <span class="expense-amt">₩ ${formatedAmt}</span>
                        <button class="del-btn" onclick="app.deleteExpenseById('${item.id}', '${item.date}')" title="삭제">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        });
    },

    async addExpenseFromModal() {
        const placeInput = document.getElementById('add-place');
        const amountInput = document.getElementById('add-amount');
        const categoryInput = document.getElementById('add-category');

        const place = placeInput.value.trim();
        const amountStr = amountInput.value.trim();
        const category = categoryInput.value;

        if (!place || !amountStr) {
            alert('상호명과 금액을 모두 입력해주세요.');
            return;
        }
        const amount = parseInt(amountStr, 10);
        if (isNaN(amount) || amount <= 0) {
            alert('올바른 금액을 입력해주세요.');
            return;
        }

        const expenseData = {
            id: uuidv4(),
            date: this.selectedDate,
            amount: amount,
            place: place,
            payer: this.currentUser,
            category: category,
            _action: 'add',
            timestamp: Date.now()
        };

        try {
            // Add to queue
            this.syncQueue.push(expenseData);
            this.saveSyncQueue();

            // Refresh Memory
            this.mergeQueueToLedger();

            const dateObj = new Date(expenseData.date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');

            // Only strictly update view if same month
            if (year === this.currentDate.getFullYear() && month === String(this.currentDate.getMonth() + 1).padStart(2, '0')) {
                this.updateDashboard();
                this.renderCalendar();
                this.renderStats();
                this.renderModalExpenses();
            }

            // Clear inputs
            placeInput.value = '';
            amountInput.value = '';

            // Optional message
            this.appendMessage(`달력에서 💸\n${expenseData.date}\n${expenseData.place}에서 ${new Intl.NumberFormat('ko-KR').format(amount)}원 지출 추가 처리 (미동기화)`, 'bot');

        } catch (e) {
            console.error(e);
            alert('지출 추가 중 오류가 발생했습니다.');
        }
    },

    async deleteExpenseById(id, date) {
        if (!confirm('이 지출 내역을 삭제하시겠습니까?')) return;

        try {
            this.syncQueue.push({
                id: id,
                date: date,
                _action: 'delete',
                timestamp: Date.now()
            });
            this.saveSyncQueue();

            const dateObj = new Date(date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');

            this.mergeQueueToLedger();

            if (year === this.currentDate.getFullYear() && month === String(this.currentDate.getMonth() + 1).padStart(2, '0')) {
                this.updateDashboard();
                this.renderCalendar();
                this.renderStats();
                this.renderModalExpenses();
            }

            this.appendMessage(`선택하신 지출 내역을 삭제 예약했습니다. (미동기화) 🗑️`, 'bot');
        } catch (e) {
            console.error(e);
            alert('삭제 중 오류가 발생했습니다.');
        }
    },

    /**
     * Scroll to the bottom of the chat window
     */
    scrollToBottom() {
        this.chatWindow.scrollTop = this.chatWindow.scrollHeight;
    },

    /**
     * Add a message bubble to the chat
     */
    appendMessage(text, sender = 'bot', isHtml = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}-message`;

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';

        if (isHtml) {
            bubbleDiv.innerHTML = text; // Used for formatting standard answers or displaying tables
        } else {
            bubbleDiv.textContent = text;
        }

        msgDiv.appendChild(bubbleDiv);
        this.chatWindow.insertBefore(msgDiv, this.typingIndicator);
        this.scrollToBottom();
    },

    showTyping() {
        this.typingIndicator.style.display = 'flex';
        this.scrollToBottom();
    },

    hideTyping() {
        this.typingIndicator.style.display = 'none';
    },

    /**
     * Send user message and begin processing
     */
    async sendMessage() {
        console.log("app.sendMessage() triggered");
        const text = this.userInput.value.trim();
        if (!text) {
            console.log("Empty text, skipping sendMessage");
            return;
        }

        // 1. Show User Message
        this.appendMessage(text, 'user');
        this.userInput.value = '';
        this.showTyping();

        try {
            // 2. Determine Intent via Gemini
            const intentRespText = await this.askGeminiIntent(text);
            const intentResp = JSON.parse(intentRespText);

            if (intentResp.intent === "ADD") {
                await this.processAddExpense(intentResp.data);
            } else if (intentResp.intent === "DELETE") {
                await this.processDeleteExpense(text);
            } else if (intentResp.intent === "INQUIRY_SUMMARY") {
                await this.processInquirySummary(text, intentResp.data);
            } else {
                await this.processInquiry(text, intentResp.data);
            }

        } catch (error) {
            console.error(error);
            this.appendMessage(`❌ 오류가 발생했어요: ${error.message}`, 'bot');
        } finally {
            this.hideTyping();
        }
    },

    // ==========================================
    // GEMINI CALLS
    // ==========================================

    /**
     * Prompt Gemini to determine what the user wants to do.
     * Requesting strictly JSON output.
     */
    async askGeminiIntent(userText) {
        const today = new Date().toISOString().split('T')[0];
        const prompt = `
당신은 가계부 작성 AI 비서입니다.
오늘 날짜는 ${today} 입니다. 날짜가 '오늘', '어제' 등으로 오면 이를 계산하세요.
현재 사용자는 "${this.currentUser}" 입니다. 별도로 결제자를 지정하지 않으면 결제자는 "${this.currentUser}"(으)로 설정하세요.
사용자의 입력을 분석하여 다음 세 가지 의도 중 하나로 분류하고, 반드시 JSON 형식으로만 응답해야 합니다 (마크다운 백틱 제외).

1. 지출 내역 추가 (intent: "ADD")
사용자가 돈을 썼다는 내용일 경우, 아래 구조로 데이터를 추출하세요 (금액은 숫자만). 카테고리는 식비, 교통비, 이자, 관리비, 통신비, 공과금, 보험, 문화생활, 모임, 쇼핑, 기타 중에서 가장 적합한 것을 고르세요.
{"intent": "ADD", "data": {"date": "YYYY-MM-DD", "amount": 10000, "place": "상호명", "payer": "결제자", "category": "분류"}}

2. 지출 내역 삭제 (intent: "DELETE")
사용자가 기존 가계부 내역에서 특정 항목을 삭제하거나 취소해달라고 요청하는 경우.
{"intent": "DELETE", "data": null}

3. 특정 내역 조회 및 질문 (intent: "INQUIRY")
사용자가 과거 내역에 대해 "구체적인 리스트나 항목"을 질문하는 경우. 이때 사용자 질문에서 "년도(YYYY)", "월(MM)", "카테고리(category)" 등 필터링할 조건이 있다면 뽑아내주세요.
없으면 null로 처리하세요. (예: "작년 식비 리스트 알려줘" -> 올해가 2026년이므로 date_prefix: "2025", category: "식비")
{"intent": "INQUIRY", "data": {"date_prefix": "YYYY-MM 혹은 YYYY", "category": "카테고리명"}}

4. 전체 통계/합산 요구 (intent: "INQUIRY_SUMMARY")
사용자가 "1년치 총 식비 얼마야?", "이번 달 총 지출은 얼마야?" 등 전체 합산 금액이나 거시적인 통계 결과를 묻는 경우.
{"intent": "INQUIRY_SUMMARY", "data": {"date_prefix": "YYYY-MM 혹은 YYYY", "category": "카테고리명"}}

사용자 입력: "${userText}"
`;
        return await this.fetchGemini(prompt);
    },

    /**
     * RAG를 통해 가계부 내역 기반으로 응답 생성.
     */
    async askGeminiRAG(userText, ledgerStr) {
        const prompt = `
당신은 가계부 상담 AI입니다.
아래의 전체 가계부 내역(JSON 리스트)을 바탕으로 사용자의 질문에 친절하고 정확하게 답변해주세요.
답변은 카카오톡 메시지처럼 자연스럽게, 그리고 표를 활용해서 깔끔하게 요약해주는 것이 좋습니다 (HTML 형식의 <table>, <tr>, <td> 사용 권장, 단 별도의 head나 body 태그 없이).

가계부 내역:
${ledgerStr}

사용자 질문: "${userText}"
`;
        return await this.fetchGemini(prompt);
    },

    async fetchGemini(promptText) {
        if (!this.geminiKey || this.geminiKey.length < 10) {
            throw new Error('Gemini API 키가 설정되지 않았거나 올바르지 않습니다. 로그아웃 후 다시 로그인해보세요.');
        }

        const url = `${GEMINI_API_URL}?key=${this.geminiKey.trim()}`;
        console.log("Gemini API 호출 시도 중...");

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { temperature: 0.1 } // 낮은 온도 세팅으로 답변 안정성 보장
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Gemini API Error Detail:", errorText);
            throw new Error(`Gemini API 요청 실패 (${response.status}). 콘솔 로그를 확인하세요.`);
        }

        const data = await response.json();
        // Remove markdown backticks if Gemini accidentally inserts them
        let textResult = data.candidates[0].content.parts[0].text.trim();
        if (textResult.startsWith("```json")) {
            textResult = textResult.substring(7);
        }
        if (textResult.startsWith("```html")) {
            textResult = textResult.substring(7);
        }
        if (textResult.endsWith("```")) {
            textResult = textResult.substring(0, textResult.length - 3);
        }
        return textResult.trim();
    },


    // ==========================================
    // FIXED EXPENSES LOGIC
    // ==========================================

    renderFixedExpenses(year, month) {
        const widgetList = document.getElementById('fixed-expenses-list');
        const widgetStatus = document.getElementById('fixed-expenses-status');
        if (!widgetList || !widgetStatus || !this.fixedExpenses) return;

        widgetList.innerHTML = '';

        if (this.fixedExpenses.length === 0) {
            widgetStatus.textContent = '설정된 내역 없음';
            widgetList.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-secondary);font-size:13px;">AI에게 "매달 1일에 월세 16만원 고정비 만들어줘"라고 말해보세요!</div>';
            return;
        }

        const prefix = `${year}-${String(month).padStart(2, '0')}`;

        // Find existing expenses matching fixed names in this month
        const thisMonthLedger = this.allLedgerData.filter(item => item.date && item.date.startsWith(prefix));

        let paidCount = 0;
        const totalCount = this.fixedExpenses.length;

        this.fixedExpenses.forEach(fixed => {
            // Very simple exact match on place, or if keyword exists in place
            const isPaid = thisMonthLedger.some(ledgerItem =>
                ledgerItem.place === fixed.name ||
                ledgerItem.place.includes(fixed.name) ||
                (fixed.name.includes(ledgerItem.place) && ledgerItem.place.length > 1)
            );

            if (isPaid) paidCount++;

            const itemDiv = document.createElement('div');
            itemDiv.className = `fixed-item ${isPaid ? 'paid' : 'unpaid'}`;

            const btnHtml = isPaid
                ? `<span style="font-size:12px;color:var(--text-secondary);">완료</span>`
                : `<button class="pay-btn" onclick="app.payFixedExpense('${fixed.id}', ${year}, ${month})">결제하기</button>`;

            itemDiv.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:16px;">${isPaid ? '✅' : '❌'}</span>
                    <div>
                        <div style="font-size:13px;font-weight:600;color:var(--text-primary);${isPaid ? 'text-decoration:line-through;color:var(--text-secondary);' : ''}">${fixed.name} (${fixed.pay_day}일)</div>
                        <div style="font-size:11px;color:var(--text-secondary);">₩ ${fixed.amount.toLocaleString()}</div>
                    </div>
                </div>
                ${btnHtml}
            `;
            widgetList.appendChild(itemDiv);
        });

        widgetStatus.textContent = `${paidCount}/${totalCount} 완료`;
    },

    toggleFixedExpenses() {
        const list = document.getElementById('fixed-expenses-list');
        if (!list) return;
        if (list.style.display === 'none') {
            list.style.display = 'block';
        } else {
            list.style.display = 'none';
        }
    },

    openFixedModal() {
        const modal = document.getElementById('fixed-modal');
        const list = document.getElementById('modal-fixed-list');
        if (!modal || !list) return;

        list.innerHTML = '';

        if (!this.fixedExpenses || this.fixedExpenses.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-secondary); font-size: 13px;">등록된 고정비가 없습니다. 아래에서 직접 추가하거나 채팅으로 말씀해 주세요!</div>';
        } else {
            this.fixedExpenses.forEach(fixed => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'expense-item';
                itemDiv.style.justifyContent = 'space-between';
                itemDiv.innerHTML = `
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:600; font-size:14px; color:var(--text-primary);">${fixed.name}</span>
                        <span style="font-size:12px; color:var(--text-secondary);">매월 ${fixed.pay_day}일 · ₩ ${fixed.amount.toLocaleString()}</span>
                    </div>
                    <button class="pay-btn" style="background:#ef4444; padding:6px 10px;" onclick="app.deleteFixedExpense('${fixed.id}')" title="삭제"><i class="fas fa-trash"></i> 삭제</button>
                `;
                list.appendChild(itemDiv);
            });
        }

        modal.style.display = 'flex';
    },

    closeFixedModal() {
        const modal = document.getElementById('fixed-modal');
        if (modal) modal.style.display = 'none';
    },

    deleteFixedExpense(id) {
        if (!confirm('이 고정비 항목을 정말 삭제할까요?')) return;

        // filter out
        this.fixedExpenses = this.fixedExpenses.filter(x => x.id !== id);

        // syncQueue에 settings_fixed 저장명령 추가
        this.syncQueue.push({
            _action: 'settings_fixed',
            data: this.fixedExpenses
        });
        this.saveSyncQueue();

        // re-render UI
        this.openFixedModal();
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth() + 1;
        this.renderFixedExpenses(year, month);
    },

    addFixedExpenseFromUI() {
        const nameInput = document.getElementById('add-fixed-name');
        const dayInput = document.getElementById('add-fixed-day');
        const amountInput = document.getElementById('add-fixed-amount');

        if (!nameInput.value.trim() || !dayInput.value || !amountInput.value) {
            alert('항목명, 이체일, 금액을 모두 정확히 입력해 주세요.');
            return;
        }

        const newFixed = {
            id: uuidv4(),
            name: nameInput.value.trim(),
            pay_day: parseInt(dayInput.value, 10),
            amount: parseInt(amountInput.value, 10),
            category: "기타" // UI 간소화를 위해 기타 처리 또는 향후 select박스 확장 가능
        };

        this.fixedExpenses.push(newFixed);

        this.syncQueue.push({
            _action: 'settings_fixed',
            data: this.fixedExpenses
        });
        this.saveSyncQueue();

        nameInput.value = '';
        dayInput.value = '';
        amountInput.value = '';

        this.openFixedModal();
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth() + 1;
        this.renderFixedExpenses(year, month);
    },

    payFixedExpense(fixedId, year, month) {
        if (!confirm('이 고정 지출을 오늘 납부한 것으로 처리할까요?')) return;

        const fixedItem = this.fixedExpenses.find(x => x.id === fixedId);
        if (!fixedItem) return;

        const todayTimestamp = new Date();
        const yyyy = todayTimestamp.getFullYear();
        const mm = String(todayTimestamp.getMonth() + 1).padStart(2, '0');
        const dd = String(todayTimestamp.getDate()).padStart(2, '0');
        const formattedDate = `${yyyy}-${mm}-${dd}`;

        const newExpense = {
            id: uuidv4(),
            date: formattedDate,
            amount: fixedItem.amount,
            place: fixedItem.name,
            payer: this.currentUser,
            category: fixedItem.category || '기타',
            _action: 'add',
            timestamp: Date.now()
        };

        this.syncQueue.push(newExpense);
        this.saveSyncQueue();
        this.mergeQueueToLedger();

        this.updateDashboard();
        this.renderCalendar();
        this.renderStats();

        this.appendMessage(`📌 ${fixedItem.name} ${fixedItem.amount.toLocaleString()}원 방금 원클릭 납부 처리 완료! (동기화 버튼을 눌러 원격에 확정하세요)`, 'bot');
    },

    // ==========================================
    // CORE LOGIC (ADD / INQUIRY / DELETE)
    // ==========================================

    /**
     * Store local sync queue to IndexedDB or LocalStorage
     */
    saveSyncQueue() {
        localStorage.setItem(`syncQueue_${this.currentUser}`, JSON.stringify(this.syncQueue));
        this.updateSyncBadge();
    },

    loadSyncQueue() {
        try {
            const data = localStorage.getItem(`syncQueue_${this.currentUser}`);
            if (data) {
                this.syncQueue = JSON.parse(data);
            }
        } catch (e) {
            this.syncQueue = [];
        }
        this.updateSyncBadge();
    },

    updateSyncBadge() {
        const badge = document.getElementById('sync-badge');
        if (!badge) return;
        if (this.syncQueue.length > 0) {
            badge.style.display = 'inline-block';
            badge.textContent = this.syncQueue.length;
        } else {
            badge.style.display = 'none';
        }
    },

    /**
     * Merge ALL items from sync queue to current allLedgerData memory
     */
    mergeQueueToLedger() {
        let mergedObj = {};

        // 1. Initial items
        this.allLedgerData.forEach(item => {
            mergedObj[item.id] = item;
        });

        // 2. Queue items (Override or Add or Delete)
        // A queue item would be an actual expense object with an additional _action field indicating logic 
        // _action: "add", "edit", "delete"
        this.syncQueue.forEach(qItem => {
            if (qItem.date) {
                if (qItem._action === 'delete') {
                    delete mergedObj[qItem.id];
                } else {
                    mergedObj[qItem.id] = { ...qItem };
                    delete mergedObj[qItem.id]._action; // remove internal action field
                }
            }
        });

        // Convert back to array and sort descending by date
        this.allLedgerData = Object.values(mergedObj).sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    /**
     * Add new expense to the local queue
     */
    async processAddExpense(expenseData) {
        // Enforce ID
        if (!expenseData.id) {
            expenseData.id = uuidv4();
        }
        expenseData._action = 'add';
        expenseData.timestamp = Date.now();

        // Add to queue
        this.syncQueue.push(expenseData);
        this.saveSyncQueue();

        // Refresh Memory List
        const dateObj = new Date(expenseData.date);
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');

        // Only if it's the current viewing month, merge to show immediately
        // Actually, since we use All-in-Memory now, just merge without params
        this.mergeQueueToLedger();
        if (year === this.currentDate.getFullYear() && month === String(this.currentDate.getMonth() + 1).padStart(2, '0')) {
            this.updateDashboard();
            this.renderCalendar();
            this.renderStats();
            if (this.selectedDate === expenseData.date) {
                this.renderModalExpenses();
            }
        }

        // Success message
        const formatedAmt = new Intl.NumberFormat('ko-KR').format(expenseData.amount);
        this.appendMessage(`완료! 💸\n${expenseData.date}\n${expenseData.place}에서 ${formatedAmt}원 지출로 장부 모음에 올려두었어요. (동기화 버튼을 눌러 확정해주세요)`, 'bot');
    },

    /**
     * Delete expense locally
     */
    async processDeleteExpense(userText) {
        if (this.allLedgerData.length === 0) {
            this.appendMessage('가계부가 비어있어 삭제할 내용이 없습니다.', 'bot');
            return;
        }

        const prompt = `
아래는 현재 가계부 내역(JSON 배열)의 최근 50건입니다.
사용자는 이 중에서 특정 지출 항목을 삭제해달라고 요청했습니다.
요청에 해당하는 항목의 **id (문자열)** 값을 찾아 JSON 배열 형식으로만 출력하세요. (예: ["id1", "id2"] 혹은 일치하는게 없으면 [])
부연 설명이나 마크다운 문법 없이 오직 배열만 출력해야 합니다.

사용자 요청: "${userText}"
현재 가계부 내역 (일부):
${JSON.stringify(this.allLedgerData.slice(0, 50))}
`;
        const idsStr = await this.fetchGemini(prompt);
        let idsToDelete = [];
        try {
            idsToDelete = JSON.parse(idsStr);
        } catch (e) {
            throw new Error("AI가 삭제 대상을 올바르게 파악하지 못했습니다.");
        }

        if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
            this.appendMessage('해당하는 지출 내역을 가계부에서 찾지 못했어요. (정확한 금액이나 식당을 알려주세요)', 'bot');
            return;
        }

        let deletedCount = 0;

        for (let targetId of idsToDelete) {
            // Find the original item from allLedgerData to get its date
            const originalItem = this.allLedgerData.find(item => item.id === targetId);
            if (originalItem) {
                // Add delete action to queue
                this.syncQueue.push({
                    id: targetId,
                    date: originalItem.date,
                    _action: 'delete',
                    timestamp: Date.now()
                });
                deletedCount++;
            }
        }

        if (deletedCount === 0) {
            this.appendMessage('해당하는 지출 내역을 찾지 못했어요.', 'bot');
            return;
        }

        this.saveSyncQueue();
        this.mergeQueueToLedger();

        // Refresh Current View Only if needed (but doing it safely is always good)
        this.updateDashboard();
        this.renderCalendar();
        this.renderStats();

        this.appendMessage(`요청하신 지출 내역 ${deletedCount}건 삭제를 예약했습니다. 🗑️ (동기화 버튼을 눌러 확정해주세요)`, 'bot');
    },

    /**
     * Convert JSON array to lightweight CSV string to save LLM tokens.
     */
    convertToCSV(dataArray) {
        if (!dataArray || dataArray.length === 0) return "No Data";
        // Extract essential keys only
        const header = "date,amount,category,place,payer";
        const rows = dataArray.map(item => {
            return `${item.date},${item.amount},${item.category || ''},"${(item.place || '').replace(/"/g, '""')}",${item.payer || ''}`;
        });
        return [header, ...rows].join('\n');
    },

    /**
     * Analyze and respond based on existing ledger contents (SMART RAG / INQUIRY)
     */
    async processInquiry(userText, filterData = null) {
        let targetData = this.allLedgerData;

        // 1. Pre-filter data to save LLM tokens and cost
        if (filterData) {
            targetData = targetData.filter(item => {
                let match = true;
                if (filterData.date_prefix && !item.date.startsWith(filterData.date_prefix)) match = false;
                if (filterData.category && item.category !== filterData.category) match = false;
                return match;
            });
        }

        if (targetData.length > 300) {
            targetData = targetData.slice(0, 300);
            this.appendMessage('⚠️ 데이터가 너무 많아 최근 300건만 분석합니다.', 'bot');
        }

        // 2. Compress payload via CSV
        let ledgerCsvStr = this.convertToCSV(targetData);

        // 3. Send context + question to Gemini
        const aiAnswerHtml = await this.askGeminiRAG(userText, ledgerCsvStr);
        this.appendMessage(aiAnswerHtml, 'bot', true);
    },

    /**
     * Process summary/aggregation intent using JS reduce.
     */
    async processInquirySummary(userText, filterData = null) {
        let targetData = this.allLedgerData;

        if (filterData) {
            targetData = targetData.filter(item => {
                let match = true;
                if (filterData.date_prefix && !item.date.startsWith(filterData.date_prefix)) match = false;
                if (filterData.category && item.category !== filterData.category) match = false;
                return match;
            });
        }

        if (targetData.length === 0) {
            this.appendMessage('해당 조건에 맞는 지출 내역이 없습니다.', 'bot');
            return;
        }

        // JS Local Reduce to create lightweight summary
        const totalAmount = targetData.reduce((sum, item) => sum + Number(item.amount), 0);

        // Group by category if user wants detailed breakdown, but simple total is enough for LLM to elaborate
        const categorySummary = targetData.reduce((acc, item) => {
            const cat = item.category || '기타';
            acc[cat] = (acc[cat] || 0) + Number(item.amount);
            return acc;
        }, {});

        const summaryObj = {
            query_filter: filterData,
            total_items_count: targetData.length,
            total_amount: totalAmount,
            by_category: categorySummary
        };

        const summaryJsonStr = JSON.stringify(summaryObj);

        const prompt = `
당신은 가계부 상담 AI입니다.
사용자가 통계/합산 정보를 요구하여 시스템 내에서 자체적으로 금액을 합산(Reduce)한 결과표를 드립니다.
아래의 요약된 시스템 자체 계산 결과를 바탕으로 사용자에게 자연스럽고 친절하게(보고서 또는 대화 형태) 안내해 주세요.

시스템 합산 요약 결과:
${summaryJsonStr}

사용자 질문: "${userText}"
        `;
        const aiAnswerHtml = await this.fetchGemini(prompt);
        this.appendMessage(aiAnswerHtml, 'bot', true);
    },


    // ==========================================
    // GITHUB OCTOKIT DATA CALLS & SYNC (Via GithubApi Module)
    // ==========================================

    /**
     * Fetch all JSON files within specific month directory
     */
    async getMonthDataFromGithub(year, month) {
        if (!this.githubApi) {
            console.error("GithubApi not initialized, skipping fetch");
            return [];
        }
        return await this.githubApi.getMonthData(year, month);
    },

    /**
     * Manual Sync Process
     */
    async syncData() {
        if (!this.githubApi) {
            alert('인증 정보가 없습니다. 다시 로그인 해주세요.');
            return;
        }

        if (this.syncQueue.length === 0) {
            alert('동기화할 내역이 없습니다.');
            return;
        }

        const syncBadge = document.getElementById('sync-badge');
        syncBadge.textContent = '...';

        this.showTyping();
        try {
            // Group queue by YYYY-MM-DD for standard ledger data,
            // or put special global tasks like settings in a separate pool.
            const groupedQueue = {};
            let hasSettingsUpdate = false;
            let latestSettingsData = null;

            this.syncQueue.forEach(item => {
                if (item._action === 'settings_fixed') {
                    hasSettingsUpdate = true;
                    latestSettingsData = item.data;
                    return; // skip folder grouping
                }

                if (!item.date) return;
                const pathParts = item.date.split('-');
                if (pathParts.length !== 3) return;

                const year = pathParts[0];
                const month = pathParts[1];
                const day = pathParts[2];
                // Using data path structure compatible with GithubApi
                const filePath = `data/${year}/${month}/${year}-${month}-${day}.json`;

                if (!groupedQueue[filePath]) groupedQueue[filePath] = [];
                groupedQueue[filePath].push(item);
            });

            // Process each file separately
            for (const [filePath, queueItems] of Object.entries(groupedQueue)) {
                await this.githubApi.syncSingleFile(filePath, queueItems);
            }

            // Sync settings if updated
            if (hasSettingsUpdate && latestSettingsData) {
                await this.githubApi.updateFixedExpenses(latestSettingsData);
            }

            // Sync successful
            this.syncQueue = [];
            this.saveSyncQueue();

            // Reload Current Month Data
            await this.loadData();

            alert('동기화가 완료되었습니다! ✨');

        } catch (err) {
            console.error(err);
            alert(`동기화 중 오류가 발생했습니다: ${err.message}`);
        } finally {
            this.hideTyping();
            this.updateSyncBadge();
        }
    }
};

// Expose app to window to ensure global access (especially for onclick attributes)
window.app = app;
