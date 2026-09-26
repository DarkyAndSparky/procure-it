// ─── Dashboard (ROADMAP_Q4.md §11) ─────────────────────────────────────────
// Никакой отдельной аналитической подсистемы — целиком поверх уже
// существовавшего /api/stats (расширенного period/byStatus/byMonth в
// 26w36-b25). Простые CSS-бары для тренда по месяцам — без графической
// библиотеки, план прямо просит не городить BI-систему.

let dashboardPeriod = ''; // '' = за всё время
let lastDashboardStats = null; // кэш последнего успешного /api/stats — экспорт не должен дёргать сеть заново, если данные уже на экране

const PERIOD_LABELS = { '': 'Всё время', today: 'Сегодня', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };

// Короткие подписи месяцев для оси тренда. НЕ переиспользует `months` из
// auth.js — тот в родительном падеже ("сентября", для дат вида "12
// сентября"), здесь нужна короткая именительная форма для узкой подписи
// под столбиком, и совпадение имени с уже существующим top-level `const
// months` в другом файле было бы синтаксической ошибкой (redeclaration
// в не-модульном скрипте).
const MONTH_ABBR = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function dashSectionHeader(label) {
  return `<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;margin:18px 0 10px">${label}</div>`;
}

async function renderDashboard() {
  const content = document.getElementById('dashboard-content');
  if (!content) return;

  const periodBtns = document.querySelectorAll('.dash-period-btn');
  periodBtns.forEach(btn => {
    btn.classList.toggle('btn-primary', btn.dataset.period === dashboardPeriod);
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => { dashboardPeriod = btn.dataset.period; renderDashboard(); });
    }
  });

  const exportBtn = document.getElementById('dash-export-btn');
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = '1';
    exportBtn.addEventListener('click', exportDashboardExcel);
  }

  content.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">Загрузка…</div>';

  let stats;
  try {
    const qs = dashboardPeriod ? `?period=${encodeURIComponent(dashboardPeriod)}` : '';
    stats = await api('GET', '/api/stats' + qs);
    lastDashboardStats = stats;
  } catch(e) {
    content.innerHTML = `<div style="color:var(--danger);padding:20px">Не удалось загрузить данные: ${esc(e.message)}</div>`;
    return;
  }

  const margin = (stats.totalSell || 0) - (stats.totalPurchase || 0);

  content.innerHTML = `
    ${dashSectionHeader('KPI по статусам')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">
      ${(stats.byStatus || []).map(s => `
        <div class="card" style="padding:14px;text-align:center">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;white-space:nowrap">${STATUS_MAP[s.status] ? STATUS_MAP[s.status].label : esc(s.status)}</div>
          <div style="font-size:24px;font-weight:700">${s.count}</div>
        </div>`).join('')}
    </div>

    ${dashSectionHeader('Финансы')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
      <div class="card" style="padding:14px">
        <div style="font-size:11px;color:var(--text-muted)">Сумма закупок</div>
        <div style="font-size:19px;font-weight:700">${fmtRub(stats.totalPurchase||0)}</div>
      </div>
      <div class="card" style="padding:14px">
        <div style="font-size:11px;color:var(--text-muted)">Сумма продаж</div>
        <div style="font-size:19px;font-weight:700;color:var(--accent)">${fmtRub(stats.totalSell||0)}</div>
      </div>
      <div class="card" style="padding:14px">
        <div style="font-size:11px;color:var(--text-muted)">Маржа</div>
        <div style="font-size:19px;font-weight:700;color:${margin>=0?'var(--success)':'var(--danger)'}">${fmtRub(margin)}</div>
      </div>
    </div>

    ${dashSectionHeader('Заявки по организациям')}
    ${(stats.byOrg && stats.byOrg.length) ? `
    <div class="card" style="padding:0;overflow:hidden;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr>
        <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600">Организация</th>
        <th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600">Заявок</th>
        <th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600">Закупка</th>
        <th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600">Продажа</th>
      </tr>
      ${stats.byOrg.map(o => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid var(--border)">${esc(o.org_short||'—')}</td>
        <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--border)">${o.count}</td>
        <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--border)">${fmtRub(o.purchase||0)}</td>
        <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--border);color:var(--accent);font-weight:600">${fmtRub(o.sell||0)}</td>
      </tr>`).join('')}
    </table>
    </div>` : `<div class="card" style="padding:16px;color:var(--text-muted);text-align:center">Нет заявок за выбранный период</div>`}

    ${dashSectionHeader('Динамика по месяцам')}
    <div class="card" style="padding:16px">
      ${(stats.byMonth && stats.byMonth.length) ? renderMonthBars(stats.byMonth) : `<div style="color:var(--text-muted);text-align:center">Недостаточно данных</div>`}
    </div>
  `;
}

// Экспорт текущего вида дашборда в Excel (ROADMAP_Q4.md §12 — «Экспорт из
// Dashboard»). Один лист, разделённый заголовками секций — так же, как
// выглядит сама страница, но таблицами вместо CSS-баров (в Excel графики
// строит сам пользователь при желании, задача экспорта — дать ему цифры,
// не рисовать за него). Денежный формат — тот же `#,##0.00 "₽"`, что и в
// exportRegistryExcel() (см. её комментарий про обязательные кавычки
// вокруг ₽ — без них Excel/SSF отказывается парсить формат).
function exportDashboardExcel() {
  const stats = lastDashboardStats;
  if (!stats) { toast('Сначала дождитесь загрузки дашборда'); return; }

  const rows = [];
  const moneyCellRows = []; // индексы строк (0-based в итоговом массиве), где колонка B/C — деньги

  rows.push([`Дашборд — период: ${PERIOD_LABELS[dashboardPeriod] || dashboardPeriod}`, `сформировано ${new Date().toLocaleString('ru-RU')}`]);
  rows.push([]);

  rows.push(['KPI по статусам']);
  rows.push(['Статус', 'Заявок']);
  (stats.byStatus || []).forEach(s => rows.push([STATUS_MAP[s.status] ? STATUS_MAP[s.status].label : s.status, s.count]));
  rows.push([]);

  rows.push(['Финансы']);
  rows.push(['Сумма закупок', stats.totalPurchase || 0]); moneyCellRows.push(rows.length - 1);
  rows.push(['Сумма продаж', stats.totalSell || 0]);       moneyCellRows.push(rows.length - 1);
  rows.push(['Маржа', (stats.totalSell||0) - (stats.totalPurchase||0)]); moneyCellRows.push(rows.length - 1);
  rows.push([]);

  rows.push(['По организациям']);
  rows.push(['Организация', 'Заявок', 'Закупка', 'Продажа']);
  (stats.byOrg || []).forEach(o => {
    rows.push([o.org_short || '—', o.count, o.purchase || 0, o.sell || 0]);
  });
  rows.push([]);

  rows.push(['Динамика по месяцам']);
  rows.push(['Месяц', 'Заявок', 'Закупка', 'Продажа']);
  (stats.byMonth || []).forEach(m => {
    rows.push([m.month, m.count, m.purchase || 0, m.sell || 0]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:28},{wch:16},{wch:16},{wch:16}];

  // Деньги: строки KPI (одна колонка B) + таблицы «По организациям»/
  // «Динамика» (колонки C и D — Закупка/Продажа). Проще всего пройти по
  // всем ячейкам листа и применить формат к тем, что реально числа и не
  // являются счётчиком "Заявок"/"Позиций" — но раз этих строк немного и
  // структура зафиксирована выше, размечаем явно, без угадывания по типу.
  moneyCellRows.forEach(r => {
    const addr = XLSX.utils.encode_cell({ r, c: 1 });
    if (ws[addr] && ws[addr].t === 'n') ws[addr].z = '#,##0.00 "₽"';
  });
  // Таблицы «По организациям» и «Динамика по месяцам» — деньги в C и D на
  // каждой строке данных (после заголовка секции + заголовка колонок).
  let r = rows.findIndex(row => row[0] === 'По организациям') + 2;
  (stats.byOrg || []).forEach(() => {
    [2, 3].forEach(c => { const a = XLSX.utils.encode_cell({r,c}); if (ws[a] && ws[a].t==='n') ws[a].z = '#,##0.00 "₽"'; });
    r++;
  });
  r = rows.findIndex(row => row[0] === 'Динамика по месяцам') + 2;
  (stats.byMonth || []).forEach(() => {
    [2, 3].forEach(c => { const a = XLSX.utils.encode_cell({r,c}); if (ws[a] && ws[a].t==='n') ws[a].z = '#,##0.00 "₽"'; });
    r++;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Дашборд');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob  = new Blob([wbout], { type: 'application/octet-stream' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `Дашборд_${PERIOD_LABELS[dashboardPeriod] || 'период'}_${dateStr}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  toast('✓ Дашборд экспортирован');
}

// Простые CSS-бары (сумма продаж по месяцам, высота — относительно
// максимума в наборе) — без библиотек, сознательно минимально. Тренд
// всегда за последние 12 месяцев с данными, не зависит от выбранного
// периода (см. комментарий у byMonth в src/routes/requests.js).
function renderMonthBars(byMonth) {
  const max = Math.max(...byMonth.map(m => m.sell || 0), 1);
  return `<div style="display:flex;align-items:flex-end;gap:8px;height:150px">
    ${byMonth.map(m => {
      const h = Math.max(Math.round((m.sell || 0) / max * 100), (m.sell||0) > 0 ? 3 : 0);
      const [y, mo] = (m.month || '').split('-');
      const label = mo ? `${MONTH_ABBR[parseInt(mo,10)-1]} '${(y||'').slice(2)}` : (m.month || '—');
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end;min-width:0">
        <div title="${esc(label)}: ${fmtRub(m.sell||0)}, заявок: ${m.count}" style="width:100%;background:var(--accent);border-radius:3px 3px 0 0;height:${h}%"></div>
        <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${esc(label)}</div>
      </div>`;
    }).join('')}
  </div>`;
}
