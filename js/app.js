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
import { uiRenderer } from "./ui/renderer.js";
import { fcmApi } from "./api/fcm.js";

const GITHUB_OWNER = 'bottleiron';
const GITHUB_REPO = 'my-ledger-data';



const app = {
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
    pendingTossData: null, // For Toss parsing flow
    currentUser: "사용자",

    elements: {},

    init() {
        this.githubPat = sessionStorage.getItem('githubPat');
        this.currentUser = sessionStorage.getItem('currentUser') || '사용자';

        if (this.githubPat && !this.githubApi) {
            this.githubApi = new GithubApi(GITHUB_OWNER, GITHUB_REPO, this.githubPat);

            // FCM Init
            const firebaseConfigStr = sessionStorage.getItem('firebaseConfig');
            if (firebaseConfigStr) {
                try {
                    const config = JSON.parse(firebaseConfigStr);
                    fcmApi.init(config);
                } catch (e) {
                    console.error("FCM integration failed (Invalid Config):", e);
                }
            }
        } else {
            // Not logged in, but app.init was called?
            console.warn("app.init() called but no user session found.");
            return;
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
            this.updatePushIcon();
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
        this.updatePushIcon();
    },

    updatePushIcon() {
        const btn = document.getElementById('push-btn');
        if (!btn) return;
        
        if (!('Notification' in window)) {
            btn.style.display = 'none';
            return;
        }

        if (Notification.permission === 'granted') {
            btn.textContent = '🔔';
            btn.title = '푸시 알림 켜짐';
            btn.style.opacity = '1';
        } else {
            btn.textContent = '🔕';
            btn.title = '푸시 알림 꺼짐 (켜려면 클릭)';
            btn.style.opacity = '0.5';
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

        let totalExpense = 0;
        let totalIncome = 0;
        let totalSavings = 0;

        this.allLedgerData.forEach(item => {
            if (item.date && item.date.startsWith(prefix)) {
                if (item.category === '수입') {
                    totalIncome += Number(item.amount);
                } else if (item.category === '저축') {
                    totalSavings += Number(item.amount);
                } else {
                    totalExpense += Number(item.amount);
                }
            }
        });

        if (this.elements.monthLabel) this.elements.monthLabel.textContent = `${year}년 ${month}월`;

        const expenseEl = document.getElementById('total-expenseAmount');
        if (expenseEl) expenseEl.textContent = `₩ ${totalExpense.toLocaleString()}`;

        const incomeEl = document.getElementById('total-incomeAmount');
        if (incomeEl) incomeEl.textContent = `₩ ${totalIncome.toLocaleString()}`;

        const savingsEl = document.getElementById('total-savingsAmount');
        if (savingsEl) savingsEl.textContent = `이달의 저축 ₩${totalSavings.toLocaleString()}`;
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
            let totalExp = 0, totalInc = 0, totalSav = 0;
            this.allLedgerData.forEach(item => {
                if (item.date && item.date.startsWith(pfx)) {
                    const amt = Number(item.amount);
                    if (item.category === '수입') totalInc += amt;
                    else if (item.category === '저축') totalSav += amt;
                    else totalExp += amt;
                }
            });
            mData.push({ label: `${m}월`, totalExp, totalInc, totalSav, year: y, month: m });
        }
        this._trendMonthsData = mData;

        // Max Y value calculation
        const maxVal = Math.max(...mData.map(m => Math.max(m.totalExp, m.totalInc, m.totalSav)), 1);
        const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
        
        // Draw Grid and Axis
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const gy = pad.top + (cH / 4) * i;
            ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
            ctx.fillStyle = '#94a3b8'; ctx.font = '10px Outfit, sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(`${((maxVal - (maxVal / 4) * i) / 10000).toFixed(0)}만`, pad.left - 8, gy + 4);
        }

        const drawTrendLine = (dataKey, color) => {
            const pts = mData.map((m, idx) => ({
                x: pad.left + (cW / Math.max(mData.length - 1, 1)) * idx,
                y: pad.top + cH - (m[dataKey] / maxVal) * cH
            }));

            if (pts.length > 1) {
                // Line
                ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) {
                    const cpX = (pts[i - 1].x + pts[i].x) / 2;
                    ctx.bezierCurveTo(cpX, pts[i - 1].y, cpX, pts[i].y, pts[i].x, pts[i].y);
                }
                ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();

                // Dots
                pts.forEach(p => {
                    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
                    ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fillStyle = 'white'; ctx.fill();
                });
            }
        };

        this._trendPoints = mData.map((m, idx) => ({
            x: pad.left + (cW / Math.max(mData.length - 1, 1)) * idx,
            data: m
        }));

        // Draw three lines with colors: Red(Income), Green(Savings), Blue(Expenses)
        drawTrendLine('totalInc', '#ef4444'); // Red
        drawTrendLine('totalSav', '#10b981'); // Green
        drawTrendLine('totalExp', '#3b82f6'); // Blue

        // X Labels
        mData.forEach((m, idx) => {
            const x = pad.left + (cW / Math.max(mData.length - 1, 1)) * idx;
            ctx.fillStyle = '#334155'; ctx.font = '10px Outfit, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(m.label, x, H - pad.bottom + 16);
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
        let html = `
            <div class="tt-title" style="margin-bottom:8px; font-weight:700;">${d.year}년 ${d.month}월</div>
            <div class="tt-row" style="display:flex; justify-content:space-between; gap:12px; font-size:12px; margin-bottom:4px;">
                <span><span style="color:#ef4444; margin-right:4px;">●</span>수입</span>
                <span style="font-weight:600;">₩${d.totalInc.toLocaleString()}</span>
            </div>
            <div class="tt-row" style="display:flex; justify-content:space-between; gap:12px; font-size:12px; margin-bottom:4px;">
                <span><span style="color:#10b981; margin-right:4px;">●</span>저축</span>
                <span style="font-weight:600;">₩${d.totalSav.toLocaleString()}</span>
            </div>
            <div class="tt-row" style="display:flex; justify-content:space-between; gap:12px; font-size:12px;">
                <span><span style="color:#3b82f6; margin-right:4px;">●</span>지출</span>
                <span style="font-weight:600;">₩${d.totalExp.toLocaleString()}</span>
            </div>
        `;
        tt.innerHTML = html; tt.style.display = 'block';
        const cW = canvas.parentElement.clientWidth;
        let left = closest.x - 70;
        if (left < 5) left = 5; if (left + 160 > cW) left = cW - 165;
        tt.style.left = `${left}px`; tt.style.top = `30px`;
    },

    // ==========================================
    // MODAL LOGIC (DAY DETAILS)
    // ==========================================

    openDayModal(year, month, day) {
        this.selectedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const titleLabel = document.getElementById('modal-date-title');
        if (titleLabel) titleLabel.textContent = `${year}년 ${month}월 ${day}일`;

        // If there's pending data from Toss notification, pre-fill it
        if (this.pendingTossData) {
            const addPlaceInput = document.getElementById('add-place');
            const addAmountInput = document.getElementById('add-amount');
            const addCategorySelect = document.getElementById('add-category');
            
            if (addPlaceInput) addPlaceInput.value = this.pendingTossData.shopName;
            if (addAmountInput) addAmountInput.value = this.pendingTossData.amount;
            if (addCategorySelect && this.pendingTossData.category) {
                addCategorySelect.value = this.pendingTossData.category;
            }
            
            // Clear used data
            this.pendingTossData = null;
        }

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
                    <span class="expense-amt ${item.category === '수입' ? 'income_txt' : ''}">${item.category === '수입' ? '+' : ''}₩ ${formatedAmt}</span>
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
            // 2. Parse Toss Notification
            const tossResult = this.parseTossNotification(text);
            
            if (tossResult) {
                // Get predicted category based on history
                tossResult.category = this.getPredictedCategory(tossResult.shopName);

                const now = new Date();
                let year = now.getFullYear();
                let month = tossResult.month || (now.getMonth() + 1);
                let day = tossResult.day || now.getDate();

                // Smart Year Logic: If extracted month/day is in the future (>1 day), assume last year
                if (tossResult.month && tossResult.day) {
                    const extractedDateInCurrentYear = new Date(year, month - 1, day);
                    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                    if (extractedDateInCurrentYear > tomorrow) {
                        year -= 1;
                    }
                }

                const dateStr = `${year}년 ${month}월 ${day}일`;
                const catInfo = tossResult.category !== '기타' ? ` (${tossResult.category}?)` : '';

                if (confirm(`${dateStr} 내역이 맞습니까?${catInfo}`)) {
                    // UI 연동: 모달 띄우기 및 자동 채우기
                    const addPlaceInput = document.getElementById('add-place');
                    const addAmountInput = document.getElementById('add-amount');
                    const addCategorySelect = document.getElementById('add-category');
                    
                    if (addPlaceInput) addPlaceInput.value = tossResult.shopName;
                    if (addAmountInput) addAmountInput.value = tossResult.amount;
                    if (addCategorySelect) addCategorySelect.value = tossResult.category;
                    
                    this.openDayModal(year, month, day);
                    this.appendMessage(`💳 결제 내역을 인식했습니다! 아래에서 추가 버튼을 눌러주세요.`, 'bot');
                } else {
                    // 저장 후 달력으로 이동
                    this.pendingTossData = tossResult;
                    this.switchView('calendar');
                    this.appendMessage(`🗓️ 달력에서 결제하신 날짜를 선택해주세요. 자동으로 내역이 채워집니다.`, 'bot');
                }
            } else {
                this.appendMessage('인식할 수 없는 알림 형식입니다. 토스뱅크 결제 알림을 그대로 붙여넣어 주세요.', 'bot');
            }
        } catch (error) {
            console.error(error);
            this.appendMessage(`❌ 오류가 발생했어요: ${error.message}`, 'bot');
        } finally {
            this.hideTyping();
        }
    },

    getPredictedCategory(shopName) {
        if (!this.allLedgerData || !shopName) return '기타';

        const target = shopName.trim().replace(/\s+/g, '');
        
        // 1. Exact Match Search (most recent first)
        const exactMatch = this.allLedgerData.find(item => 
            item.place.trim().replace(/\s+/g, '') === target
        );
        if (exactMatch) return exactMatch.category;

        // 2. Keyword/Substring Search
        const similarMatches = this.allLedgerData.filter(item => {
            const p = item.place.trim().replace(/\s+/g, '');
            if (p.length < 2) return false;
            return target.includes(p) || p.includes(target);
        });

        if (similarMatches.length > 0) {
            const counts = {};
            similarMatches.forEach(m => {
                const weight = (m.place === shopName) ? 5 : 1;
                counts[m.category] = (counts[m.category] || 0) + weight;
            });
            return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        }

        return '기타';
    },

    parseTossNotification(text) {
        if (!text) return null;

        // 1. Normalize: Replace newlines and multiple spaces with a single space
        const cleanText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        
        // 2. Extract Amount
        const amountMatch = cleanText.match(/([\d,]+)원/);
        if (!amountMatch) return null;
        const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);

        // 3. Extract Date (MM/DD)
        let month = null, day = null;
        const dateMatch = cleanText.match(/(\d{1,2})\/(\d{1,2})/);
        if (dateMatch) {
            month = parseInt(dateMatch[1], 10);
            day = parseInt(dateMatch[2], 10);
        }

        // 4. Extract Shop Name
        let shopName = '';
        if (cleanText.includes('|')) {
            // Format A: Standard delimited format
            shopName = cleanText.split('|')[1].split('잔액')[0].trim();
        } else if (cleanText.includes('출금됐어요')) {
            // Format B (Meeting/Withdrawal): Multi-line or Single-line
            // Extract the part following the core withdrawal phrase
            const afterWithdrawArr = cleanText.split('출금됐어요');
            if (afterWithdrawArr.length > 1) {
                let afterWithdraw = afterWithdrawArr[1].trim();
                
                // Remove junk suffixes
                afterWithdraw = afterWithdraw.split('거래한')[0];
                afterWithdraw = afterWithdraw.split('모임원')[0];
                afterWithdraw = afterWithdraw.split('잔액')[0];
                
                // Remove date (MM/DD) and time (HH:mm) from the shop name candidate
                afterWithdraw = afterWithdraw.replace(/\d{1,2}\/\d{1,2}/g, '');
                afterWithdraw = afterWithdraw.replace(/\d{1,2}:\d{1,2}/g, '');
                
                // Remove leading/trailing formatting characters like '.', ',', '님', or extra spaces
                shopName = afterWithdraw.replace(/^[.\s님,:]+/, '').replace(/[.\s님,:]+$/, '').trim();
            }
        }

        if (amount > 0 && shopName) {
            return { amount, shopName, month, day };
        }
        return null;
    },

    // ==========================================
    // GEMINI CALLS
    // ==========================================

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
        this.appendMessage(`완료! 💸\\n${expenseData.date}\\n${expenseData.place}에서 ${formatedAmt}원 지출로 장부 모음에 올려두었어요. (동기화 버튼을 눌러 확정해주세요)`, 'bot');
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

            // Process each file separately — only the LAST commit should trigger CI (FCM notification)
            const fileEntries = Object.entries(groupedQueue);
            const totalSyncSteps = fileEntries.length + (hasSettingsUpdate && latestSettingsData ? 1 : 0);
            let currentStep = 0;

            for (const [filePath, queueItems] of fileEntries) {
                currentStep++;
                const isLast = currentStep === totalSyncSteps;
                await this.githubApi.syncSingleFile(filePath, queueItems, this.currentUser, isLast);
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
