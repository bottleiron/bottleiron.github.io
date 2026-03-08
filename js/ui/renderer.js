import { Solar, Lunar } from "lunar-javascript";
import { ANNIVERSARIES } from "../constants.js";

export const uiRenderer = {
    renderCalendar(year, month, allLedgerData, isCurrentMonth, today, callbacks) {
        const grid = document.getElementById('calendar-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const firstDay = new Date(year, month - 1, 1).getDay();
        const daysInMonth = new Date(year, month, 0).getDate();

        const dailyExpense = {};
        const dailyIncome = {};
        allLedgerData.forEach(item => {
            if (item.date && item.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
                const day = parseInt(item.date.split('-')[2], 10);
                if (item.category === '수입') {
                    dailyIncome[day] = (dailyIncome[day] || 0) + Number(item.amount);
                } else {
                    dailyExpense[day] = (dailyExpense[day] || 0) + Number(item.amount);
                }
            }
        });

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
            const isTodayClass = isCurrentMonth && day === today.getDate() ? 'today' : '';
            let amountHtml = '';
            if (dailyIncome[day]) {
                amountHtml += `<div class="cal-amount income_txt">+${dailyIncome[day].toLocaleString()}</div>`;
            }
            if (dailyExpense[day]) {
                amountHtml += `<div class="cal-amount expense_txt">-${dailyExpense[day].toLocaleString()}</div>`;
            }

            let anniversaryHtml = '';
            if (dailyAnniversaries[day]) {
                const icons = dailyAnniversaries[day].map(a => `<span title="${a.label}">${a.icon}</span>`).join('');
                anniversaryHtml = `<div class="cal-anniversary">${icons}</div>`;
            }

            const currentDow = new Date(year, month - 1, day).getDay();
            let weekendClass = '';
            if (currentDow === 0) weekendClass = 'text-sunday';
            else if (currentDow === 6) weekendClass = 'text-saturday';

            const dayDiv = document.createElement('div');
            dayDiv.className = `cal-day ${isTodayClass}`;
            dayDiv.style.position = 'relative';
            dayDiv.innerHTML = `
                <div class="cal-date ${weekendClass}">${day}</div>
                ${anniversaryHtml}
                ${amountHtml}
            `;
            dayDiv.onclick = () => callbacks.onDayClick(year, month, day);
            grid.appendChild(dayDiv);
        }
    },

    renderCategoryStats(statsDate, allLedgerData) {
        const year = statsDate.getFullYear();
        const month = statsDate.getMonth() + 1;
        const label = document.getElementById('stats-month-label');
        if (label) label.textContent = `${year}년 ${month}월`;

        const categoryTotals = {};
        let totalExpense = 0;
        let totalIncome = 0;
        const prefix = `${year}-${String(month).padStart(2, '0')}`;

        allLedgerData.forEach(item => {
            if (item.date && item.date.startsWith(prefix)) {
                if (item.category === '수입') {
                    totalIncome += Number(item.amount);
                } else {
                    const cat = item.category || '기타';
                    categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(item.amount);
                    totalExpense += Number(item.amount);
                }
            }
        });

        const chartContainer = document.getElementById('stats-chart');
        const listContainer = document.getElementById('stats-list');
        if (!chartContainer || !listContainer) return;

        chartContainer.innerHTML = '';
        listContainer.innerHTML = '';

        if (totalExpense === 0 && totalIncome === 0) {
            chartContainer.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:20px 0;">거래 내역이 없습니다.</div>';
        } else {
            if (totalIncome > 0) {
                listContainer.innerHTML += `<div class="stat-item" style="background:#fef2f2;border-radius:10px;margin-bottom:8px;"><span class="stat-cat" style="color:var(--accent);">총 수입</span><span class="stat-amt" style="color:var(--accent);font-size:16px;">+ ₩ ${totalIncome.toLocaleString()}</span></div>`;
            }
            if (totalExpense > 0) {
                listContainer.innerHTML += `<div class="stat-item" style="background:var(--primary-light);border-radius:10px;margin-bottom:4px;"><span class="stat-cat" style="color:var(--primary);">총 지출</span><span class="stat-amt" style="color:var(--primary);font-size:16px;">- ₩ ${totalExpense.toLocaleString()}</span></div>`;
                const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
                sorted.forEach(([cat, amount]) => {
                    const pct = ((amount / totalExpense) * 100).toFixed(1);
                    chartContainer.innerHTML += `<div class="stat-bar-container"><div class="stat-info"><span>${cat}</span><span>${pct}%</span></div><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${pct}%"></div></div></div>`;
                    listContainer.innerHTML += `<div class="stat-item"><span class="stat-cat">${cat}</span><span class="stat-amt">₩ ${amount.toLocaleString()}</span></div>`;
                });
            }
        }
    }
};
