/**
 * app.js
 * Core application logic to handle conversational parsing by Gemini and 
 * reading/writing to GitHub via GithubApi class (No-Build Architecture).
 */

import { v4 as uuidv4 } from "uuid";
import { GithubApi } from "./github-api.js";

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
    ledgerData: [], // Current month data
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
            const year = this.currentDate.getFullYear();
            const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
            // Fetch all files for the current month
            this.ledgerData = await this.getMonthDataFromGithub(year, month);
            this.mergeQueueToLedger(year, month);

            this.updateDashboard();
            this.renderCalendar();
            this.renderStats();
        } catch (error) {
            console.error("Failed to load data:", error);
            // Even if failed, merge queue and render
            const year = this.currentDate.getFullYear();
            const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
            this.mergeQueueToLedger(year, month);
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

        const total = this.ledgerData.reduce((sum, item) => {
            if (item.date && item.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
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
        this.ledgerData.forEach(item => {
            if (item.date && item.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
                const day = parseInt(item.date.split('-')[2], 10);
                dailyTotals[day] = (dailyTotals[day] || 0) + Number(item.amount);
            }
        });

        for (let i = 0; i < firstDay; i++) {
            grid.innerHTML += `<div class="cal-day empty"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = isCurrentMonth && day === today.getDate() ? 'today' : '';
            const amountHtml = dailyTotals[day] ? `<div class="cal-amount">${dailyTotals[day].toLocaleString()}</div>` : '';
            grid.innerHTML += `
                <div class="cal-day ${isToday}" onclick="app.openDayModal(${year}, ${month}, ${day})">
                    <div class="cal-date">${day}</div>
                    ${amountHtml}
                </div>
            `;
        }
    },

    renderStats() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth() + 1;

        const categoryTotals = {};
        let totalMonth = 0;

        this.ledgerData.forEach(item => {
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
        const dayItems = this.ledgerData.filter(item => item.date === this.selectedDate);

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
            const dateObj = new Date(expenseData.date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            this.mergeQueueToLedger(year, month);
            this.updateDashboard();
            this.renderCalendar();
            this.renderStats();
            this.renderModalExpenses();

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
            this.mergeQueueToLedger(year, month);
            this.updateDashboard();
            this.renderCalendar();
            this.renderStats();
            this.renderModalExpenses();

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
            } else {
                await this.processInquiry(text);
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
사용자가 돈을 썼다는 내용일 경우, 아래 구조로 데이터를 추출하세요 (금액은 숫자만). 카테고리는 식비, 교통비, 문화생활, 모임, 쇼핑, 기타 중에서 가장 적합한 것을 고르세요.
{"intent": "ADD", "data": {"date": "YYYY-MM-DD", "amount": 10000, "place": "상호명", "payer": "결제자", "category": "분류"}}

2. 지출 내역 삭제 (intent: "DELETE")
사용자가 기존 가계부 내역에서 특정 항목을 삭제하거나 취소해달라고 요청하는 경우.
{"intent": "DELETE", "data": null}

3. 내역 조회 및 질문 (intent: "INQUIRY")
사용자가 과거 내역에 대해 질문하는 경우, 데이터 필드 없이 반환하세요.
{"intent": "INQUIRY"}

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
     * Merge items from sync queue to current ledgerData memory
     */
    mergeQueueToLedger(year, month) {
        // Find queue items matching current YYYY-MM
        const prefix = `${year}-${String(month).padStart(2, '0')}`;

        let mergedObj = {};
        // 1. Initial items
        this.ledgerData.forEach(item => {
            mergedObj[item.id] = item;
        });

        // 2. Queue items (Override or Add or Delete)
        // A queue item would be an actual expense object with an additional _action field indicating logic 
        // _action: "add", "edit", "delete"
        this.syncQueue.forEach(qItem => {
            if (qItem.date && qItem.date.startsWith(prefix)) {
                if (qItem._action === 'delete') {
                    delete mergedObj[qItem.id];
                } else {
                    mergedObj[qItem.id] = { ...qItem };
                    delete mergedObj[qItem.id]._action; // remove internal action field
                }
            }
        });

        this.ledgerData = Object.values(mergedObj);
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
        if (year === this.currentDate.getFullYear() && month === String(this.currentDate.getMonth() + 1).padStart(2, '0')) {
            this.mergeQueueToLedger(year, month);
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
        if (this.ledgerData.length === 0) {
            this.appendMessage('이번 달 가계부가 비어있어 삭제할 내용이 없습니다.', 'bot');
            return;
        }

        const prompt = `
아래는 현재 가계부 내역(JSON 배열)입니다.
사용자는 이 중에서 특정 지출 항목을 삭제해달라고 요청했습니다.
요청에 해당하는 항목의 **id (문자열)** 값을 찾아 JSON 배열 형식으로만 출력하세요. (예: ["id1", "id2"] 혹은 일치하는게 없으면 [])
부연 설명이나 마크다운 문법 없이 오직 배열만 출력해야 합니다.

사용자 요청: "${userText}"
현재 가계부 내역:
${JSON.stringify(this.ledgerData)}
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
            // Find the original item from ledgerData to get its date
            const originalItem = this.ledgerData.find(item => item.id === targetId);
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

        const year = this.currentDate.getFullYear();
        const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
        this.mergeQueueToLedger(year, month);
        this.updateDashboard();
        this.renderCalendar();
        this.renderStats();

        this.appendMessage(`요청하신 지출 내역 ${deletedCount}건 삭제를 예약했습니다. 🗑️ (동기화 버튼을 눌러 확정해주세요)`, 'bot');
    },

    /**
     * Analyze and respond based on existing ledger contents
     */
    async processInquiry(userText) {
        let ledgerStr = JSON.stringify(this.ledgerData);
        // 2. Send context + question to Gemini
        const aiAnswerHtml = await this.askGeminiRAG(userText, ledgerStr);
        // 3. Display answer
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
            // Group queue by YYYY-MM-DD
            const groupedQueue = {};
            this.syncQueue.forEach(item => {
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
