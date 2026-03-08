/**
 * app.js
 * Core application logic to handle conversational parsing by Gemini and 
 * reading/writing to GitHub via GithubApi class (No-Build Architecture).
 */

import { v4 as uuidv4 } from "uuid";
import { GithubApi } from "./github-api.js";
import { Solar, Lunar } from "lunar-javascript";
import { CATEGORIES, ANNIVERSARIES } from "./constants.js";
import { idb } from "./core/store.js";
import { geminiApi } from "./api/gemini.js";
import { uiRenderer } from "./ui/renderer.js";
import { fcmApi } from "./api/fcm.js";

const GITHUB_OWNER = 'bottleiron';
const GITHUB_REPO = 'my-ledger-data';



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

    elements: {},

    init() {
        this.geminiKey = sessionStorage.getItem('geminiKey');
        this.githubPat = sessionStorage.getItem('githubPat');
        this.currentUser = sessionStorage.getItem('currentUser') || '사용자';

        if (this.geminiKey) {
            try {
                geminiApi.init(this.geminiKey);
            } catch (e) {
                console.warn(e);
            }
        }

        if (this.githubPat && !this.githubApi) {
            this.githubApi = new GithubApi(GITHUB_OWNER, GITHUB_REPO, this.githubPat);

            // FCM Init
            fcmApi.init();
        }

        console.log("app.init() called, user:", this.currentUser);

        this.cacheDOM();

        // 1. Initial State UI setups
        if (!this.elements.chatInput || !this.elements.chatContainer) {
            console.log("Elements not found, retrying init...");
            setTimeout(() => this.init(), 50);
            return;
        }
        console.log("Elements found, continuing init");

        // Check if event listener was already added to prevent duplicates on multiple inits
        if (!this._isInitialized) {
            this.elements.chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });
            // Initialize typing indicator (it should be in HTML, just manage its visibility)
            // this.typingIndicator = document.createElement('div');
            // this.typingIndicator.id = 'typing-indicator';
            // this.typingIndicator.innerHTML = '<div class="dot-flashing"></div>';
            // this.chatWindow.appendChild(this.typingIndicator);

            // Setup Tab Switching
            document.querySelectorAll('.tab-item').forEach(tab => {
                tab.addEventListener('click', () => {
                    const viewName = tab.getAttribute('data-view');
                    this.switchView(viewName);
                });
            });

            // Populate category select options dynamically from constants
            const catOptionsHTML = CATEGORIES.map(c => `<option value="${c}" ${c === '기타' ? 'selected' : ''}>${c}</option>`).join('');
            const addCatSelect = document.getElementById('add-category');
            if (addCatSelect) addCatSelect.innerHTML = catOptionsHTML;
            const fixCatSelect = document.getElementById('add-fixed-category');
            if (fixCatSelect) fixCatSelect.innerHTML = catOptionsHTML;

            this._isInitialized = true;
            this.loadSyncQueue();
            this.loadData();
        }
    },

    cacheDOM() {
        this.elements = {
            chatContainer: document.getElementById('chat-window'),
            chatInput: document.getElementById('user-input'),
            syncBadge: document.getElementById('sync-badge'),
            globalLoading: document.getElementById('global-loading'),
            typingIndicator: document.getElementById('typing-indicator'),
            monthLabel: document.querySelector('.month-label'),
            totalAmount: document.querySelector('.total-amount')
        };
    },

    async enablePushNotifications() {
        if (!this.githubApi) {
            alert('인증 정보가 없습니다. 다시 로그인 해주세요.');
            return;
        }
        await fcmApi.requestPermission(this.githubApi, this.currentUser);
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
        let cachedLedger = null;
        let cachedFixed = null;

        try {
            cachedLedger = await idb.get(`cachedAllData_${this.currentUser}`);
            cachedFixed = await idb.get(`cachedFixed_${this.currentUser}`);
        } catch (e) {
            console.warn("IndexedDB ü ", e);
        }

        // 만약 캐시가 하나도 없다면(=처음 로그인하는 기기라면) 전체 화면 로딩 띄우기
        if (!cachedLedger || !cachedFixed) {
            this.showGlobalLoading('초기 가계부 데이터를 불러오고 있습니다...');
        } else {
            this.showTyping(); // 기존처럼 채팅방 타이핑 인디케이터만
        }

        try {
            // 1. Try to load from IndexedDB cache first for instant UX
            if (cachedLedger) {
                this.allLedgerData = cachedLedger;
            }
            if (cachedFixed) {
                this.fixedExpenses = cachedFixed;
            }

            this.mergeQueueToLedger();
            this.updateDashboard();
            this.renderCalendar();
            this.renderStats();

            // 2. Fetch all data from GitHub in JS background
            if (this.githubApi) {
                const freshData = await this.githubApi.fetchAllData();
                this.allLedgerData = freshData;
                await idb.set(`cachedAllData_${this.currentUser}`, freshData);

                const freshFixed = await this.githubApi.getFixedExpenses();
                this.fixedExpenses = freshFixed;
                await idb.set(`cachedFixed_${this.currentUser}`, freshFixed);

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
            this.hideGlobalLoading(); // 로딩창이 켜져있었다면 끄기
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

        if (this.elements.monthLabel) this.elements.monthLabel.textContent = `${year}년 ${month}월`;
        if (this.elements.totalAmount) this.elements.totalAmount.textContent = `₩ ${total.toLocaleString()}`;
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

        const today = new Date();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month - 1;

        uiRenderer.renderCalendar(year, month, this.allLedgerData, isCurrentMonth, today, {
            onDayClick: (y, m, d) => this.openDayModal(y, m, d)
        });

        // Render fixed expenses widget
        this.renderFixedExpenses(year, month);
    },

    statsDate: null,
    trendPeriod: 3,
    _trendMonthsData: [],
    _trendPoints: [],

    getStatsDate() {
        if (!this.statsDate) this.statsDate = new Date(this.currentDate);
        return this.statsDate;
    },

    changeStatsMonth(delta) {
        const d = this.getStatsDate();
        d.setMonth(d.getMonth() + delta);
        this.renderCategoryStats();
    },

    switchStatsTab(tab) {
        document.querySelectorAll('.stats-sub-tab').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-stats-view') === tab);
        });
        const catView = document.getElementById('stats-category-view');
        const trendView = document.getElementById('stats-trend-view');
        if (catView) catView.classList.toggle('active', tab === 'category');
        if (trendView) trendView.classList.toggle('active', tab === 'trend');
        if (tab === 'trend') this.renderTrendChart();
    },

    renderStats() {
        this.renderCategoryStats();
        const trendView = document.getElementById('stats-trend-view');
        if (trendView && trendView.classList.contains('active')) this.renderTrendChart();
    },

    renderCategoryStats() {
        uiRenderer.renderCategoryStats(this.getStatsDate(), this.allLedgerData);
    },

    setTrendPeriod(months) {
        this.trendPeriod = months;
        document.querySelectorAll('.period-btn').forEach(btn => btn.classList.toggle('active', btn.textContent === `${months}개월`));
        this.renderTrendChart();
    },

    renderTrendChart() {
        const canvas = document.getElementById('trend-canvas');
        if (!canvas) return;
        const container = canvas.parentElement;
        canvas.width = container.clientWidth || 380;
        canvas.height = 220;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const pad = { top: 30, right: 20, bottom: 35, left: 50 };
        ctx.clearRect(0, 0, W, H);
        const now = new Date();
        const mData = [];
        for (let i = this.trendPeriod - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear(), m = d.getMonth() + 1;
            const pfx = `${y}-${String(m).padStart(2, '0')}`;
            let total = 0;
            const catTotals = {};
            this.allLedgerData.forEach(item => {
                if (item.date && item.date.startsWith(pfx)) {
                    total += Number(item.amount);
                    const cat = item.category || '기타';
                    catTotals[cat] = (catTotals[cat] || 0) + Number(item.amount);
                }
            });
            mData.push({ label: `${m}월`, total, catTotals, year: y, month: m });
        }
        this._trendMonthsData = mData;
        const maxT = Math.max(...mData.map(m => m.total), 1);
        const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const gy = pad.top + (cH / 4) * i;
            ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
            ctx.fillStyle = '#94a3b8'; ctx.font = '10px Outfit, sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(`${((maxT - (maxT / 4) * i) / 10000).toFixed(0)}만`, pad.left - 8, gy + 4);
        }
        const pts = mData.map((m, idx) => ({
            x: pad.left + (cW / Math.max(mData.length - 1, 1)) * idx,
            y: pad.top + cH - (m.total / maxT) * cH,
            data: m
        }));
        this._trendPoints = pts;
        if (pts.length > 1) {
            // Draw Gradient Fill
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                const cpX = (pts[i - 1].x + pts[i].x) / 2;
                ctx.bezierCurveTo(cpX, pts[i - 1].y, cpX, pts[i].y, pts[i].x, pts[i].y);
            }
            ctx.lineTo(pts[pts.length - 1].x, pad.top + cH); ctx.lineTo(pts[0].x, pad.top + cH); ctx.closePath();
            const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
            grad.addColorStop(0, 'rgba(99,102,241,0.25)'); grad.addColorStop(1, 'rgba(99,102,241,0.02)');
            ctx.fillStyle = grad; ctx.fill();

            // Draw Line
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                const cpX = (pts[i - 1].x + pts[i].x) / 2;
                ctx.bezierCurveTo(cpX, pts[i - 1].y, cpX, pts[i].y, pts[i].x, pts[i].y);
            }
            ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2.5; ctx.stroke();
        }
        pts.forEach(p => {
            ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#6366f1'; ctx.fill();
            ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fillStyle = 'white'; ctx.fill();
            ctx.fillStyle = '#334155'; ctx.font = '10px Outfit, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(p.data.label, p.x, H - pad.bottom + 16);
        });
        canvas.onmousemove = (e) => { const r = canvas.getBoundingClientRect(); this._showTrendTooltip(e.clientX - r.left, e.clientY - r.top, canvas); };
        canvas.onmouseleave = () => { const tt = document.getElementById('trend-tooltip'); if (tt) tt.style.display = 'none'; };
        canvas.ontouchmove = (e) => { e.preventDefault(); const t = e.touches[0], r = canvas.getBoundingClientRect(); this._showTrendTooltip(t.clientX - r.left, t.clientY - r.top, canvas); };
        canvas.ontouchend = () => { const tt = document.getElementById('trend-tooltip'); if (tt) tt.style.display = 'none'; };
    },

    _showTrendTooltip(mx, my, canvas) {
        if (!this._trendPoints || !this._trendPoints.length) return;
        const tt = document.getElementById('trend-tooltip');
        if (!tt) return;
        let closest = null, minD = Infinity;
        this._trendPoints.forEach(p => { const d = Math.abs(p.x - mx); if (d < minD) { minD = d; closest = p; } });
        if (!closest || minD > 30) { tt.style.display = 'none'; return; }
        const d = closest.data;
        let html = `<div class="tt-title">${d.year}년 ${d.month}월</div><div class="tt-total">총 ₩${d.total.toLocaleString()}</div>`;
        if (d.total > 0) { Object.entries(d.catTotals).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => { html += `<div class="tt-row"><span>${cat}</span><span>₩${amt.toLocaleString()}</span></div>`; }); }
        tt.innerHTML = html; tt.style.display = 'block';
        const cW = canvas.parentElement.clientWidth;
        let left = closest.x - 70;
        if (left < 5) left = 5; if (left + 150 > cW) left = cW - 155;
        tt.style.left = `${left}px`; tt.style.top = `${Math.max(closest.y - 10, 5)}px`;
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
        const dayItems = this.allLedgerData.filter(item => item.date === this.selectedDate);

        if (dayItems.length === 0) {
            listDiv.innerHTML = '<div class="empty-msg">이날의 지출 내역이 없습니다.</div>';
            return;
        }



        dayItems.forEach(item => {
            const formatedAmt = new Intl.NumberFormat('ko-KR').format(item.amount);
            const itemDiv = document.createElement('div');
            itemDiv.className = 'expense-item';
            itemDiv.id = `expense-item-${item.id}`;

            // 기본 보기 모드
            itemDiv.innerHTML = `
                <div class="expense-info">
                    <span class="expense-place">${item.place}</span>
                    <span class="expense-cat">${item.category || '기타'}</span>
                </div>
                <div class="expense-right">
                    <span class="expense-amt">₩ ${formatedAmt}</span>
                    <button class="edit-btn" onclick="app.editExpenseById('${item.id}')" title="수정">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="del-btn" onclick="app.deleteExpenseById('${item.id}', '${item.date}')" title="삭제">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `;
            listDiv.appendChild(itemDiv);
        });
    },

    editExpenseById(id) {
        const item = this.allLedgerData.find(i => i.id === id);
        if (!item) return;

        const catOptions = CATEGORIES.map(c =>
            `<option value="${c}" ${c === (item.category || '기타') ? 'selected' : ''}>${c}</option>`
        ).join('');

        const itemDiv = document.getElementById(`expense-item-${id}`);
        if (!itemDiv) return;

        itemDiv.className = 'expense-item editing';
        itemDiv.innerHTML = `
            <div class="add-form flex-col w-100 gap-8">
                <input type="text" id="edit-place-${id}" value="${item.place}" placeholder="상호명">
                <div class="form-row">
                    <input type="number" id="edit-amount-${id}" value="${item.amount}" placeholder="금액" style="width: 55%;">
                    <select id="edit-category-${id}" style="width: 45%;">
                        ${catOptions}
                    </select>
                </div>
                <div class="flex-row gap-8" style="justify-content:flex-end; margin-top: 4px;">
                    <button onclick="app.renderModalExpenses()" class="btn-secondary" style="padding: 10px 16px; font-size: 13px; border-radius: 10px;">취소</button>
                    <button onclick="app.saveEditedExpense('${id}')" class="add-btn" style="margin-top: 0; padding: 10px 16px; font-size: 13px; border-radius: 10px;">저장</button>
                </div>
            </div>
        `;
    },

    saveEditedExpense(id) {
        const placeInput = document.getElementById(`edit-place-${id}`);
        const amountInput = document.getElementById(`edit-amount-${id}`);
        const categoryInput = document.getElementById(`edit-category-${id}`);

        if (!placeInput || !amountInput || !categoryInput) return;

        const place = placeInput.value.trim();
        const amount = parseInt(amountInput.value, 10);
        const category = categoryInput.value;

        if (!place || isNaN(amount) || amount <= 0) {
            alert('상호명과 올바른 금액을 입력해주세요.');
            return;
        }

        // Find existing item
        const item = this.allLedgerData.find(i => i.id === id);
        if (!item) return;

        // Push edit to sync queue
        const editedItem = {
            ...item,
            place: place,
            amount: amount,
            category: category,
            _action: 'add', // 'add' with same id = overwrite
            timestamp: Date.now()
        };

        this.syncQueue.push(editedItem);
        this.saveSyncQueue();
        this.mergeQueueToLedger();

        this.updateDashboard();
        this.renderCalendar();
        this.renderStats();
        this.renderModalExpenses();

        this.appendMessage(`✏️ ${place} ${new Intl.NumberFormat('ko-KR').format(amount)}원 (${category})으로 수정했어요. (동기화 버튼을 눌러 확정해주세요)`, 'bot');
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
        if (this.elements.chatContainer) {
            this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;
        }
    },

    /**
     * Add a message bubble to the chat
     */
    appendMessage(text, sender = 'bot', isHtml = false) {
        if (!this.elements.chatContainer) return;

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', `${sender}-message`);

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';

        if (isHtml) {
            bubbleDiv.innerHTML = text; // Used for formatting standard answers or displaying tables
        } else {
            bubbleDiv.textContent = text;
            bubbleDiv.innerHTML = bubbleDiv.innerHTML.replace(/\n/g, '<br/>'); // Preserve newlines
        }

        msgDiv.appendChild(bubbleDiv);
        this.elements.chatContainer.appendChild(msgDiv);
        this.scrollToBottom();
    },

    showTyping() {
        if (this.elements.typingIndicator) {
            this.elements.typingIndicator.classList.add('show');
            this.scrollToBottom();
        }
    },

    hideTyping() {
        if (this.elements.typingIndicator) {
            this.elements.typingIndicator.classList.remove('show');
        }
    },

    showGlobalLoading(message = '로딩 중...') {
        if (this.elements.globalLoading) {
            this.elements.globalLoading.querySelector('.loading-message').textContent = message;
            this.elements.globalLoading.style.display = 'flex';
        }
    },

    hideGlobalLoading() {
        if (this.elements.globalLoading) {
            this.elements.globalLoading.style.display = 'none';
        }
    },

    /**
     * Send user message and begin processing
     */
    async sendMessage() {
        console.log("app.sendMessage() triggered");
        const text = this.elements.chatInput.value.trim();
        if (!text) {
            console.log("Empty text, skipping sendMessage");
            return;
        }

        // 1. Show User Message
        this.appendMessage(text, 'user');
        this.elements.chatInput.value = '';
        this.showTyping();

        try {
            // 2. Determine Intent via Gemini
            const today = new Date().toISOString().split('T')[0];
            const intentRespText = await geminiApi.askGeminiIntent(text, today, this.currentUser);
            const intentResp = JSON.parse(intentRespText);

            if (intentResp.intent === "ADD") {
                await this.processAddExpense(intentResp.data);
            } else if (intentResp.intent === "ADD_FIXED") {
                await this.processAddFixed(intentResp.data);
            } else if (intentResp.intent === "DELETE") {
                await this.processDeleteExpense(text);
            } else if (intentResp.intent === "EDIT") {
                await this.processEditExpense(text);
            } else if (intentResp.intent === "INQUIRY_SUMMARY") {
                await this.processInquirySummary(text, intentResp.data);
            } else if (intentResp.intent === "ANALYSIS") {
                await this.processAnalysis(text, intentResp.data);
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
    // This function is now handled by geminiApi.askGeminiIntent
    // async askGeminiIntent(userText) {
    //     const today = new Date().toISOString().split('T')[0];
    //     const prompt = `
    // 당신은 가계부 작성 AI 비서입니다.
    // 오늘 날짜는 ${today} 입니다. 날짜가 '오늘', '어제' 등으로 오면 이를 계산하세요.
    // 현재 사용자는 "${this.currentUser}" 입니다. 별도로 결제자를 지정하지 않으면 결제자는 "${this.currentUser}"(으)로 설정하세요.
    // 사용자의 입력을 분석하여 다음 의도 중 하나로 분류하고, 반드시 JSON 형식으로만 응답해야 합니다 (마크다운 백틱 제외).

    // 1. 지출 내역 추가 (intent: "ADD")
    // 사용자가 돈을 썼다는 내용일 경우, 아래 구조로 데이터를 추출하세요 (금액은 숫자만). 카테고리는 식비, 교통비, 이자, 관리비, 통신비, 공과금, 보험, 문화생활, 모임, 쇼핑, 그리시유, 경조사비, 저축, 기타 중에서 가장 적합한 것을 고르세요.
    // {"intent": "ADD", "data": {"date": "YYYY-MM-DD", "amount": 10000, "place": "상호명", "payer": "결제자", "category": "분류"}}

    // 2. 고정비 등록 (intent: "ADD_FIXED")
    // 사용자가 "매달", "매월", "고정비", "정기", "자동이체" 등 반복적인 지출 항목을 등록하려는 경우. 매달 몇 일에 납부하는지(pay_day), 항목명(name), 금액(amount), 카테고리(category)를 추출하세요.
    // {"intent": "ADD_FIXED", "data": {"name": "항목명", "pay_day": 1, "amount": 150000, "category": "분류"}}

    // 3. 지출 내역 삭제 (intent: "DELETE")
    // 사용자가 기존 가계부 내역에서 특정 항목을 삭제하거나 취소해달라고 요청하는 경우.
    // {"intent": "DELETE", "data": null}

    // 4. 지출 내역 수정 (intent: "EDIT")
    // 사용자가 기존에 입력한 가계부 내역의 금액, 상호명, 카테고리 등을 수정하거나 변경해달라고 요청하는 경우. 예: "어제 스타벅스 5000원 금액 4500원으로 바꿔줘", "2월 25일 관리비 카테고리 공과금으로 수정해줘"
    // {"intent": "EDIT", "data": null}

    // 5. 특정 내역 조회 및 질문 (intent: "INQUIRY")
    // 사용자가 과거 내역에 대해 "구체적인 리스트나 항목"을 질문하는 경우. 이때 사용자 질문에서 "년도(YYYY)", "월(MM)", "카테고리(category)" 등 필터링할 조건이 있다면 뽑아내주세요.
    // 없으면 null로 처리하세요. (예: "작년 식비 리스트 알려줘" -> 올해가 2026년이므로 date_prefix: "2025", category: "식비")
    // {"intent": "INQUIRY", "data": {"date_prefix": "YYYY-MM 혹은 YYYY", "category": "카테고리명"}}

    // 6. 전체 통계/합산 요구 (intent: "INQUIRY_SUMMARY")
    // 사용자가 "1년치 총 식비 얼마야?", "이번 달 총 지출은 얼마야?" 등 전체 합산 금액이나 거시적인 통계 결과를 묻는 경우.
    // {"intent": "INQUIRY_SUMMARY", "data": {"date_prefix": "YYYY-MM 혹은 YYYY", "category": "카테고리명"}}

    // 7. 지출 분석 및 개선 조언 (intent: "ANALYSIS")
    // 사용자가 "내 지출 분석해줘", "어떻게 하면 돈을 아낄까?", "이번 달 지출 패턴 어때?" 등 통계를 넘어선 분석 및 조언을 구하는 경우.
    // {"intent": "ANALYSIS", "data": {"date_prefix": "YYYY-MM 혹은 YYYY", "category": "카테고리명"}}

    // 사용자 입력: "${userText}"
    // `;
    //     return await this.fetchGemini(prompt);
    // },

    /**
     * RAG를 통해 가계부 내역 기반으로 응답 생성.
     */
    // This function is now handled by geminiApi.askGeminiRAG
    // async askGeminiRAG(userText, ledgerStr) {
    //     const prompt = `
    // 당신은 가계부 상담 AI입니다.
    // 아래의 전체 가계부 내역(JSON 리스트)을 바탕으로 사용자의 질문에 친절하고 정확하게 답변해주세요.
    // 응답은 일반 텍스트 대신 깔끔하고 세련된 HTML 템플릿 구조를 활용해 주세요.
    // * 중요: <html>, <body> 태그는 제외하고 내부 HTML만 작성.
    // * 중요표시: 핵심 금액이나 단어는 <b style="color:var(--primary);">강조</b>처리.
    // * 리스트/표: 반복되는 내역은 가독성 좋은 <ul><li> 혹은 <table>을 사용하세요 (인라인 CSS 사용 가능, border-collapse, padding 등).

    // 가계부 내역:
    // ${ledgerStr}

    // 사용자 질문: "${userText}"
    // `;
    //     return await this.fetchGemini(prompt);
    // },

    // This function is now handled by geminiApi.fetchGemini
    // async fetchGemini(promptText) {
    //     if (!this.geminiKey || this.geminiKey.length < 10) {
    //         throw new Error('Gemini API 키가 설정되지 않았거나 올바르지 않습니다. 로그아웃 후 다시 로그인해보세요.');
    //     }

    //     const url = `${GEMINI_API_URL}?key=${this.geminiKey.trim()}`;
    //     console.log("Gemini API 호출 시도 중...");

    //     const response = await fetch(url, {
    //         method: 'POST',
    //         headers: { 'Content-Type': 'application/json' },
    //         body: JSON.stringify({
    //             contents: [{ parts: [{ text: promptText }] }],
    //             generationConfig: { temperature: 0.1 } // 낮은 온도 세팅으로 답변 안정성 보장
    //         })
    //     });

    //     if (!response.ok) {
    //         const errorText = await response.text();
    //         console.error("Gemini API Error Detail:", errorText);
    //         throw new Error(`Gemini API 요청 실패 (${response.status}). 콘솔 로그를 확인하세요.`);
    //     }

    //     const data = await response.json();
    //     // Remove markdown backticks if Gemini accidentally inserts them
    //     let textResult = data.candidates[0].content.parts[0].text.trim();
    //     if (textResult.startsWith("```json")) {
    //         textResult = textResult.substring(7);
    //     }
    //     if (textResult.startsWith("```html")) {
    //         textResult = textResult.substring(7);
    //     }
    //     if (textResult.endsWith("```")) {
    //         textResult = textResult.substring(0, textResult.length - 3);
    //     }
    //     return textResult.trim();
    // },


    // ==========================================
    // FIXED EXPENSES LOGIC
    // ==========================================

    /**
     * Process ADD_FIXED intent from chat
     */
    async processAddFixed(fixedData) {
        if (!fixedData || !fixedData.name || !fixedData.amount) {
            this.appendMessage('고정비 정보를 정확히 인식하지 못했어요. "매달 1일에 관리비 15만원 고정비 등록해줘"처럼 말해보세요!', 'bot');
            return;
        }

        const newFixed = {
            id: uuidv4(),
            name: fixedData.name,
            pay_day: fixedData.pay_day || 1,
            amount: fixedData.amount,
            category: fixedData.category || '기타'
        };

        this.fixedExpenses.push(newFixed);

        this.syncQueue.push({
            _action: 'settings_fixed',
            data: this.fixedExpenses
        });
        this.saveSyncQueue();

        // Update cache
        await idb.set(`cachedFixed_${this.currentUser}`, this.fixedExpenses);

        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth() + 1;
        this.renderFixedExpenses(year, month);

        const formatedAmt = new Intl.NumberFormat('ko-KR').format(newFixed.amount);
        this.appendMessage(`📌 고정비 등록 완료!\n${newFixed.name} · 매월 ${newFixed.pay_day}일 · ${formatedAmt}원 (${newFixed.category})\n동기화 버튼을 눌러 확정해주세요!`, 'bot');
    },

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
            // Match on place name AND exact amount to prevent false positives
            const isPaid = thisMonthLedger.some(ledgerItem =>
                (ledgerItem.place === fixed.name ||
                    ledgerItem.place.includes(fixed.name) ||
                    (fixed.name.includes(ledgerItem.place) && ledgerItem.place.length > 1)) &&
                Number(ledgerItem.amount) === Number(fixed.amount)
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

        modal.classList.add('show');
    },

    closeFixedModal() {
        const modal = document.getElementById('fixed-modal');
        if (modal) modal.classList.remove('show');
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
        const categoryInput = document.getElementById('add-fixed-category');

        if (!nameInput.value.trim() || !dayInput.value || !amountInput.value) {
            alert('항목명, 이체일, 금액을 모두 정확히 입력해 주세요.');
            return;
        }

        const newFixed = {
            id: uuidv4(),
            name: nameInput.value.trim(),
            pay_day: parseInt(dayInput.value, 10),
            amount: parseInt(amountInput.value, 10),
            category: categoryInput.value
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
        const fixedItem = this.fixedExpenses.find(x => x.id === fixedId);
        if (!fixedItem) return;

        let targetDayStr = String(fixedItem.pay_day).padStart(2, '0');

        if (!confirm(`이번 달 ${fixedItem.name}을(를) ${fixedItem.pay_day}일에 결제하신 게 맞나요?`)) {
            const inputDay = prompt("결제하신 날짜(일)를 숫자로 입력해주세요.");
            if (!inputDay) return; // Use cancelled prompt or gave empty string

            const parsedDay = parseInt(inputDay, 10);
            if (isNaN(parsedDay) || parsedDay < 1 || parsedDay > 31) {
                alert("올바른 일자(숫자)를 입력해주세요.");
                return;
            }
            targetDayStr = String(parsedDay).padStart(2, '0');
        }

        const mm = String(month).padStart(2, '0');
        const formattedDate = `${year}-${mm}-${targetDayStr}`;

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
        if (!this.elements.syncBadge) return;
        if (this.syncQueue.length > 0) {
            this.elements.syncBadge.style.display = 'inline-block';
            this.elements.syncBadge.textContent = this.syncQueue.length;
        } else {
            this.elements.syncBadge.style.display = 'none';
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
        const idsStr = await geminiApi.fetchGemini(prompt);
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
     * Edit expense via chat using Gemini to identify target and changes
     */
    async processEditExpense(userText) {
        if (this.allLedgerData.length === 0) {
            this.appendMessage('가계부가 비어있어 수정할 내용이 없습니다.', 'bot');
            return;
        }

        const prompt = `
아래는 현재 가계부 내역(JSON 배열)의 최근 50건입니다.
사용자는 이 중에서 특정 지출 항목을 수정해달라고 요청했습니다.
요청에 해당하는 항목의 **id**를 찾고, 수정할 필드와 새 값을 아래 JSON 형식으로만 출력하세요.
카테고리는 식비, 교통비, 이자, 관리비, 통신비, 공과금, 보험, 문화생활, 모임, 쇼핑, 그리시유, 경조사비, 저축, 기타 중에서 골라주세요.
부연 설명이나 마크다운 문법 없이 오직 JSON만 출력해야 합니다.

일치하는 항목이 없으면: {"id": null}
일치하는 항목이 있으면: {"id": "대상id", "changes": {"변경할필드": "새값"}}
changes에 들어갈 수 있는 필드: place(상호명), amount(금액, 숫자), category(카테고리)

사용자 요청: "${userText}"
현재 가계부 내역 (일부):
${JSON.stringify(this.allLedgerData.slice(0, 50))}
`;
        const resultStr = await geminiApi.fetchGemini(prompt);
        let editResult;
        try {
            editResult = JSON.parse(resultStr);
        } catch (e) {
            throw new Error("AI가 수정 대상을 올바르게 파악하지 못했습니다.");
        }

        if (!editResult.id) {
            this.appendMessage('해당하는 지출 내역을 가계부에서 찾지 못했어요. (날짜, 금액, 상호명을 정확히 알려주세요)', 'bot');
            return;
        }

        const originalItem = this.allLedgerData.find(item => item.id === editResult.id);
        if (!originalItem) {
            this.appendMessage('해당하는 지출 내역을 찾지 못했어요.', 'bot');
            return;
        }

        // Apply changes
        const editedItem = { ...originalItem };
        const changes = editResult.changes || {};
        let changeDesc = [];

        if (changes.place) {
            changeDesc.push(`상호명: ${originalItem.place} → ${changes.place}`);
            editedItem.place = changes.place;
        }
        if (changes.amount !== undefined) {
            const newAmt = Number(changes.amount);
            changeDesc.push(`금액: ${new Intl.NumberFormat('ko-KR').format(originalItem.amount)}원 → ${new Intl.NumberFormat('ko-KR').format(newAmt)}원`);
            editedItem.amount = newAmt;
        }
        if (changes.category) {
            changeDesc.push(`카테고리: ${originalItem.category || '기타'} → ${changes.category}`);
            editedItem.category = changes.category;
        }

        if (changeDesc.length === 0) {
            this.appendMessage('수정할 내용을 파악하지 못했어요. 다시 말씀해 주세요.', 'bot');
            return;
        }

        editedItem._action = 'add'; // same id = overwrite
        editedItem.timestamp = Date.now();

        this.syncQueue.push(editedItem);
        this.saveSyncQueue();
        this.mergeQueueToLedger();

        this.updateDashboard();
        this.renderCalendar();
        this.renderStats();

        this.appendMessage(`✏️ 수정 완료!\n${changeDesc.join('\n')}\n(동기화 버튼을 눌러 확정해주세요)`, 'bot');
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
        const aiAnswerHtml = await geminiApi.askGeminiRAG(userText, ledgerCsvStr);
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
아래의 요약된 시스템 자체 계산 결과를 바탕으로 사용자에게 자연스럽고 친절하게 안내해 주세요.
결과는 가독성이 높은 HTML 요소를 활용하세요 (표, 리스트, 강조 색상 등).
* 핵심 정보 강조 (예: <span style="font-size:16px; font-weight:bold; color:var(--accent);">금액</span>)

시스템 합산 요약 결과:
${summaryJsonStr}

사용자 질문: "${userText}"
        `;
        const aiAnswerHtml = await geminiApi.fetchGemini(prompt);
        this.appendMessage(aiAnswerHtml, 'bot', true);
    },

    /**
     * Process deep analysis & feedback (SMART RAG for advice)
     */
    async processAnalysis(userText, filterData = null) {
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
            this.appendMessage('분석할 지출 내역이 부족합니다.', 'bot');
            return;
        }

        // Limit data to prevent token explosion
        if (targetData.length > 500) {
            targetData = targetData.slice(0, 500);
            this.appendMessage('⚠️ 분석 대상 데이터가 많아 최근 500건을 기준으로 분석합니다.', 'bot', true);
        }

        const ledgerCsvStr = this.convertToCSV(targetData);

        const prompt = `
당신은 똑똑하고 냉철한(하지만 친절한) 재무 상담사 AI입니다.
아래 가계부 내역 데이터를 분석하여, 사용자의 지출 패턴, 과소비 여부, 그리고 개선 방향(절약 팁)을 브리핑해 주세요.
응답 형식은 깔끔한 HTML이어야 하며, <html> <body> 태그는 제외하세요.
* 요약 섹션 추가
* 눈에 띄게 큰 금액(카테고리) 강조
* 구체적인 액션 아이템(개선 방안) 제시
* 이모지 적극 활용
* 숫자는 보기 쉽게 천 단위 콤마 표기 (예: 1,000,000)

가계부 내역:
${ledgerCsvStr}

사용자 요청: "${userText}"
`;
        const aiAnswerHtml = await geminiApi.fetchGemini(prompt);
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

        this.showGlobalLoading('데이터 동기화중입니다...');
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
                // Using data path structure compatible with GithubApi
                const filePath = `data/${year}-${month}.json`;

                if (!groupedQueue[filePath]) groupedQueue[filePath] = [];
                groupedQueue[filePath].push(item);
            });

            // Process each file separately
            for (const [filePath, queueItems] of Object.entries(groupedQueue)) {
                await this.githubApi.syncSingleFile(filePath, queueItems, this.currentUser);
            }

            // Sync settings if updated
            if (hasSettingsUpdate && latestSettingsData) {
                await this.githubApi.updateFixedExpenses(latestSettingsData);
            }

            // Sync successful
            this.syncQueue = [];
            this.saveSyncQueue();

            // Refresh local storage cache before loading
            // Fetch fresh data immediately and update cache
            const freshData = await this.githubApi.fetchAllData();
            this.allLedgerData = freshData;
            await idb.set(`cachedAllData_${this.currentUser}`, freshData);

            const freshFixed = await this.githubApi.getFixedExpenses();
            this.fixedExpenses = freshFixed;
            await idb.set(`cachedFixed_${this.currentUser}`, freshFixed);

            // Reload Current Month Data (Now with fresh cache)
            await this.loadData();

            alert('동기화가 완료되었습니다! ✨');

        } catch (err) {
            console.error(err);
            alert(`동기화 중 오류가 발생했습니다: ${err.message}`);
        } finally {
            this.hideGlobalLoading();
            this.updateSyncBadge();
        }
    },

    /**
     * Fetch latest data from GitHub without syncing local changes
     */
    async fetchLatestData() {
        if (!this.githubApi) {
            alert('인증 정보가 없습니다. 다시 로그인 해주세요.');
            return;
        }

        if (this.syncQueue.length > 0) {
            if (!confirm('동기화되지 않은 내역이 있습니다. 최신 데이터를 가져오면 아직 동기화되지 않은 내역과 섞여 보일 수 있습니다. 계속할까요?')) {
                return;
            }
        }

        this.showGlobalLoading('최신 데이터를 불러오는 중입니다...');
        try {
            const freshData = await this.githubApi.fetchAllData();
            this.allLedgerData = freshData;
            await idb.set(`cachedAllData_${this.currentUser}`, freshData);

            const freshFixed = await this.githubApi.getFixedExpenses();
            this.fixedExpenses = freshFixed;
            await idb.set(`cachedFixed_${this.currentUser}`, freshFixed);

            // Merge local unsynced queue back on top of fresh data
            this.mergeQueueToLedger();

            this.updateDashboard();
            this.renderCalendar();
            this.renderStats();

            alert('최신 데이터를 성공적으로 가져왔습니다! 🔄');
        } catch (err) {
            console.error(err);
            alert(`데이터를 가져오는 중 오류가 발생했습니다: ${err.message}`);
        } finally {
            this.hideGlobalLoading();
        }
    },

    /**
     * Show full screen loading overlay
     */
    showGlobalLoading(text = '데이터 동기화중입니다...') {
        const loading = document.getElementById('global-loading');
        const textEl = document.getElementById('global-loading-text');
        if (textEl) textEl.textContent = text;
        if (loading) loading.classList.add('show');
    },

    /**
     * Hide full screen loading overlay
     */
    hideGlobalLoading() {
        const loading = document.getElementById('global-loading');
        if (loading) loading.classList.remove('show');
    }
};

// Expose app to window to ensure global access (especially for onclick attributes)
window.app = app;
