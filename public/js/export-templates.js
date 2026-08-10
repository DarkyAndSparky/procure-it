// ─── Registry export ──────────────────────────────────────────────────────────
function exportRegistryExcel() {
  const list = allReqs.length ? allReqs : db.requests;
  if (!list || list.length === 0) { toast('Нет заявок для экспорта'); return; }

  // Collect active filters for filename and header
  const filterOrg      = document.getElementById('reg-filter-org')?.value || '';
  const filterMonth    = document.getElementById('reg-filter-month')?.value || '';
  const filterStatus   = document.getElementById('reg-filter-status')?.value || '';
  const filterSupplier = document.getElementById('reg-filter-supplier')?.value || '';
  const search         = document.getElementById('reg-search')?.value || '';

  const filterParts = [];
  if (filterOrg)      filterParts.push(db.orgs.find(o=>o.id===filterOrg)?.short || filterOrg);
  if (filterMonth)    filterParts.push(filterMonth);
  if (filterStatus)   filterParts.push(STATUS_MAP[filterStatus]?.label || filterStatus);
  if (filterSupplier) filterParts.push(filterSupplier);
  if (search)         filterParts.push(`поиск:${search}`);

  const filterLabel = filterParts.length ? ` [${filterParts.join(', ')}]` : '';
  const dateStr     = new Date().toISOString().slice(0, 10);
  const fname       = `Реестр_заявок${filterLabel}_${dateStr}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');

  // Header row
  const rows = [['№', 'Спецификация', 'Дата', 'Организация', 'Заявка', 'МОЛ',
    'Поставщик', 'Договор', 'Битрикс', 'Позиций', 'Сумма (₽)', 'Статус', 'Путь папки']];

  // Info row if filtered
  if (filterParts.length) {
    rows.push([`Фильтр: ${filterParts.join(' · ')} — ${list.length} из всего`]);
  }

  list.forEach((r, i) => {
    rows.push([
      i + 1,
      r.specNum,
      r.date,
      r.orgShort,
      r.name,
      r.mol || '',
      r.supplier || '',
      r.contract || '',
      r.bitrix || '',
      r.positions.length,
      r.total,
      STATUS_MAP[r.status || 'new']?.label || '',
      buildFolderPath(r),
    ]);
  });

  // Totals row
  const sumRow = Array(13).fill('');
  sumRow[0]  = 'Итого:';
  sumRow[9]  = list.reduce((s, r) => s + r.positions.length, 0);
  sumRow[10] = list.reduce((s, r) => s + (r.total || 0), 0);
  rows.push(sumRow);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    {wch:4},{wch:16},{wch:12},{wch:14},{wch:40},
    {wch:22},{wch:20},{wch:14},{wch:10},{wch:8},{wch:14},{wch:12},{wch:50}
  ];

  // Bold header
  const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'EFF6FF' } } };
  for (let c = 0; c < 13; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) ws[addr].s = headerStyle;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Реестр заявок');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob  = new Blob([wbout], { type: 'application/octet-stream' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  toast(`Экспортировано ${list.length} заявок`);
}

// ─── Templates ────────────────────────────────────────────────────────────────
function populateTemplateSelect() {
  const sel = document.getElementById('template-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">+ Из шаблона</option>';
  (db.templates||[]).forEach((t,i) => {
    sel.innerHTML += `<option value="${i}">${esc(t.name)} (${t.positions.length} поз.)</option>`;
  });
}

async function savePositionsAsTemplate() {
  const rows = document.getElementById('positions-body').children;
  if (rows.length === 0) { toast('Нет позиций для сохранения'); return; }
  const name = prompt('Название шаблона:', 'Стандартный комплект');
  if (!name) return;
  const positions = [];
  for (const tr of rows) {
    const commentEl = tr.children[3].querySelector('input,select');
    positions.push({
      name: tr.children[2].querySelector('input').value,
      comment: commentEl ? commentEl.value : '',
      link: tr.children[4].querySelector('input').value,
      qty: parseNum(tr.children[5].querySelector('input').value)||1,
      unit: tr.children[6].querySelector('input').value||'шт',
      purchasePrice: parseNum(tr.children[7].querySelector('input').value)||0
    });
  }
  await api('POST', '/api/templates', { name, positions });
  db.templates = await api('GET', '/api/templates');
  populateTemplateSelect();
  toast('Шаблон сохранён: ' + name);
}

function addFromTemplate() {
  const sel = document.getElementById('template-select');
  const idx = parseInt(sel.value);
  if (isNaN(idx)) return;
  const t = db.templates[idx];
  if (!t) return;
  t.positions.forEach(p => addRow(p.name, p.qty, p.unit||'шт', 0, p.link||'', p.purchasePrice||p.price||0, p.comment||'', ''));
  sel.value = '';
  toast(`Добавлено ${t.positions.length} позиций из шаблона «${t.name}»`);
}

// ─── Theme ───────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  if (theme === 'dark') { root.classList.add('dark'); document.getElementById('theme-btn').textContent = '☀️'; }
  else if (theme === 'light') { root.classList.add('light'); document.getElementById('theme-btn').textContent = '🌙'; }
  else {
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.getElementById('theme-btn').textContent = sys ? '☀️' : '🌙';
  }
  try { localStorage.setItem('zakupki_theme', theme); } catch(e) {}
  // Reapply custom accent for new theme
  if (appConfig && appConfig.accentLight) applyConfig();
}

function toggleTheme() {
  const cur = localStorage.getItem('zakupki_theme') || 'auto';
  const next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto';
  applyTheme(next);
}

// ─── Excel import ─────────────────────────────────────────────────────────────
function importFromExcel(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });

      // ── 1. Пытаемся найти лист/строку с понятными заголовками колонок ──
      // Это покрывает и простой формат «Наименование|Кол-во|Ед.|Цена», и
      // собственный экспорт приложения («Расчёты» с листом «Спецификация»
      // или листом месяца, где колонки идут в другом порядке и есть лишние
      // столбцы типа ЮЛ/ФИО/Ссылка).
      const norm = s => String(s || '').toLowerCase().trim();

      function findHeaderRow(sheetData) {
        for (let ri = 0; ri < Math.min(sheetData.length, 10); ri++) {
          const row = sheetData[ri] || [];
          const nameCol = row.findIndex(c => norm(c).includes('наименование'));
          if (nameCol === -1) continue;
          const cols = { name: nameCol };
          const taken = new Set([nameCol]);
          const qtyCol = row.findIndex((c, i) => !taken.has(i) && ['кол-во','кол во','количество'].some(p => norm(c).includes(p)));
          if (qtyCol !== -1) { cols.qty = qtyCol; taken.add(qtyCol); }
          // Колонку единиц измерения ищем только по короткому точному
          // заголовку («Ед.», «Ед») — иначе подстрока «ед.» ложно
          // совпадает с «Цена за ед., руб.» и утаскивает не ту колонку.
          const unitCol = row.findIndex((c, i) => {
            if (taken.has(i)) return false;
            const t = norm(c);
            return t === 'ед.' || t === 'ед' || t === 'ед,шт';
          });
          if (unitCol !== -1) { cols.unit = unitCol; taken.add(unitCol); }
          // Цена закупа — проверяем «закуп» раньше общего «цена», чтобы не
          // перепутать с «Цена продажи за единицу» из собственного экспорта.
          const pricePatterns = ['цена закупа за ед', 'цена закупа', 'цена ед', 'цена за ед', 'цена'];
          let priceCol = -1;
          for (const p of pricePatterns) {
            priceCol = row.findIndex((c, i) => !taken.has(i) && norm(c).includes(p));
            if (priceCol !== -1) break;
          }
          if (priceCol !== -1) cols.price = priceCol;
          return { headerRow: ri, cols };
        }
        return null;
      }

      // Предпочитаем колонку с ЗАКУПОЧНОЙ ценой (там, где она есть) —
      // лист «Спецификация» показывает цену ПРОДАЖИ (с наценкой), и если
      // impортировать её как «Цена закупа», наценка задним числом
      // задвоится. Поэтому перебираем все листы и берём тот вариант, где
      // цена распознана как закупочная (по паттерну «закуп»), а не просто
      // первый попавшийся лист с колонкой «Наименование».
      const candidates = [];
      for (const sn of wb.SheetNames) {
        const sheetData = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
        const found = findHeaderRow(sheetData);
        if (found) candidates.push({ sheetData, ...found, sheetName: sn });
      }
      let picked = null;
      if (candidates.length) {
        // priceRank: 0 — колонка явно закупочная, 1 — цена не найдена
        // отдельной колонкой (нейтрально), 2 — колонка похожа на цену
        // ПРОДАЖИ/без явного «закуп» (наименее желательно для «Цена закупа»).
        const rank = c => {
          if (c.cols.price === undefined) return 1;
          const header = norm((c.sheetData[c.headerRow] || [])[c.cols.price]);
          if (header.includes('закуп')) return 0;
          if (header.includes('продаж')) return 2;
          return 1;
        };
        picked = candidates.slice().sort((a, b) => rank(a) - rank(b))[0];
      }

      let added = 0;

      if (picked) {
        const { sheetData, headerRow, cols } = picked;
        for (let ri = headerRow + 1; ri < sheetData.length; ri++) {
          const row = sheetData[ri];
          if (!row) continue;
          const rawName = String(row[cols.name] ?? '').trim();
          if (!rawName) continue;
          if (norm(rawName) === 'итого' || norm(rawName).startsWith('итого')) continue;
          const qtyRaw = cols.qty !== undefined ? row[cols.qty] : '';
          const qty = parseFloat(String(qtyRaw).replace(',', '.')) || 1;
          const unit = cols.unit !== undefined && row[cols.unit] ? String(row[cols.unit]).trim() : 'шт';
          const priceRaw = cols.price !== undefined ? row[cols.price] : '';
          const price = parseFloat(String(priceRaw).replace(',', '.')) || 0;
          addRow(rawName, qty, unit, price);
          added++;
        }
      } else {
        // ── 2. Фолбэк — простой позиционный формат без заголовков ──
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        for (const row of data) {
          if (!row || row.length < 2) continue;
          const first = String(row[0]).toLowerCase();
          if (first.includes('наимен') || first.includes('товар') || first === '№' || first === 'n') continue;

          const name  = String(row[0] || '').trim();
          const qty   = parseFloat(String(row[1]).replace(',','.')) || 1;
          const unit  = row.length >= 3 ? String(row[2] || 'шт').trim() : 'шт';
          const price = row.length >= 4 ? parseFloat(String(row[3]).replace(',','.')) || 0 : 0;

          if (!name) continue;
          addRow(name, qty, unit, price);
          added++;
        }
      }

      document.getElementById('import-hint').textContent = added > 0
        ? `✅ Добавлено ${added} позиций`
        : '⚠️ Позиции не найдены. Формат: Наименование | Кол-во | Ед. | Цена';
      document.getElementById('import-hint').style.color = added > 0 ? 'var(--success)' : 'var(--warning)';
    } catch(err) {
      document.getElementById('import-hint').textContent = '❌ Ошибка чтения файла';
      document.getElementById('import-hint').style.color = 'var(--danger)';
    }
  };
  reader.readAsBinaryString(file);
}

