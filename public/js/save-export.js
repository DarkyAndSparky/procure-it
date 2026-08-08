// ─── Bitrix24 ─────────────────────────────────────────────────────────────────
async function sendToBitrix() {
  if (!appConfig.bitrixWebhook) {
    toast('⚠️ Webhook не настроен — укажите URL в Конфиге');
    return;
  }
  const req = collectForm();
  if (!req.name) { toast('Введите название заявки'); return; }
  if (req.positions.length === 0) { toast('Добавьте хотя бы одну позицию'); return; }

  const btn = document.getElementById('btn-bitrix');
  const prev = btn?.textContent;
  if (btn) { btn.textContent = '⏳ Отправка…'; btn.disabled = true; }
  try {
    await api('POST', '/api/send-bitrix', req);
    toast('✓ Заявка отправлена в Bitrix24');
  } catch(e) {
    toast('Ошибка Bitrix: ' + e.message);
  } finally {
    if (btn) { btn.textContent = prev; btn.disabled = false; }
  }
}

// ─── Save ────────────────────────────────────────────────────────────────────
async function saveRequest() {
  const req = collectForm();
  if (!req.orgId) { toast('Выберите организацию'); return; }
  if (!req.name) { toast('Введите название заявки'); return; }
  if (req.positions.length === 0) { toast('Добавьте хотя бы одну позицию'); return; }

  try {
    let savedReq;
    if (editingId) {
      req.id = editingId;
      const orig = await api('GET', '/api/requests/' + editingId).catch(() => null);
      if (orig) req.specNum = orig.specNum;
      savedReq = await api('PUT', '/api/requests/' + editingId, req);
      toast('Заявка обновлена: ' + req.specNum);
      editingId = null;
      setEditingState(false);
    } else {
      savedReq = await api('POST', '/api/requests', req);
      toast('Заявка сохранена: ' + req.specNum);
    }
    updateSpecNum();

    // Auto-layout files to network folder if configured
    if (appConfig.networkFolder && savedReq?.id) {
      layoutFilesToFolder(savedReq.id, req).catch(e => {
        console.warn('[layout]', e.message);
        toast('⚠️ Файлы не разложены: ' + e.message);
      });
    }
  } catch(e) { /* toast already shown */ }
}

// ─── Export Excel ─────────────────────────────────────────────────────────────
function exportExcel() {
  const req = collectForm();
  if (req.positions.length === 0) { toast('Нет позиций для экспорта'); return; }
  buildAndDownloadExcel(req);
}

function buildAndDownloadExcel(req, existingWb) {
  const wb = existingWb || XLSX.utils.book_new();
  const monthName = RU_MONTHS[new Date(req.date).getMonth()];
  const year = new Date(req.date).getFullYear();
  const sheetName = `${monthName} ${year}`;
  const isRealization = req.isRealization || false;

  // ── Хелперы ──────────────────────────────────────────────────────────────
  const border = { style: 'thin', color: { rgb: '000000' } };
  const allBorders = { top: border, bottom: border, left: border, right: border };

  function applyBorders(ws, range) {
    // range: { s: {r,c}, e: {r,c} }
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        if (!ws[addr].s) ws[addr].s = {};
        ws[addr].s.border = allBorders;
      }
    }
  }


  // ── Лист 1: Расчёты ──────────────────────────────────────────────────────
  const calcRows = [];
  // Row 0 (index): пустая
  calcRows.push(Array(15).fill(''));
  // Row 1: шапка с доставкой
  calcRows.push(['Потребности пользователей', '', '', '', '', '', '', 'Доставка', req.deliveryCost || 0, '', '', '', '', '', '']);
  // Row 2: заголовки колонок
  calcRows.push([
    'ЮЛ','ФИО','№ ПП','Наименование','Кол-во','Где закуп',
    'Цена ед.','Цена закупа','% от заказа для доставки','Доля доставки',
    'Цена закупа за ед с доставкой','Цена закупа с доставкой','',
    'Цена продажи за единицу','Стоимость продажи'
  ]);

  const dataStartRow = 3; // 0-indexed row where first data row goes
  const totalPurchase = req.totalPurchase || 0;
  const deliveryCost  = req.deliveryCost  || 0;
  const markup        = req.markup ?? 5;
  const posCount      = req.positions.length;
  const itogExcelRow  = dataStartRow + posCount + 1; // 1-based Excel row of итого — pre-calculated for formula refs

  req.positions.forEach((p, i) => {
    const rowNum = dataStartRow + i + 1; // 1-based Excel row

    const yul = isRealization
      ? (p.rowOrgName || p.comment || '')
      : (i === 0 ? (req.orgFull || req.orgShort || '') : '');
    const fio = isRealization
      ? (p.comment || p.rowOrgName || '')
      : (i === 0 ? (p.comment || req.mol || '') : (p.comment || ''));

    // Колонки (0-based): A=0 … O=14
    // G (col 6) = purchasePrice, E (col 4) = qty
    // H (col 7) = G*E  → формула =G{row}*E{row}
    // I (col 8) = H/totalPurchase  → =H{row}/I2  (I2 хранит totalPurchase)
    // J (col 9) = I * deliveryCost → =I{row}*I2
    // K (col 10) = G + J/E         → =G{row}+J{row}/E{row}
    // L (col 11) = K * E           → =K{row}*E{row}
    // N (col 13) = K * (1+markup%) → =K{row}*(1+R2/100)   R2 = markup cell
    // O (col 14) = N * E           → =N{row}*E{row}

    // Для простоты считаем значения как раньше (fallback для книги без XLSX formula support)
    // и параллельно пишем формулы — SheetJS запишет формулы в ячейки
    const purchaseSum  = p.purchasePrice * p.qty;
    const pctOfOrder   = totalPurchase > 0 ? purchaseSum / totalPurchase : 0;
    const deliveryShare = pctOfOrder * deliveryCost;
    const ppWithDel    = p.qty > 0 ? p.purchasePrice + deliveryShare / p.qty : p.purchasePrice;
    const sellPerUnit  = p.sellPerUnit || ppWithDel * (1 + markup / 100);
    const sellSum      = p.sellSum || sellPerUnit * p.qty;

    const r = dataStartRow + i + 1; // Excel row (1-based)

    calcRows.push([
      { v: yul, t: 's' },                            // A: ЮЛ
      { v: fio, t: 's' },                            // B: ФИО
      { v: i + 1, t: 'n' },                          // C: №ПП
      { v: p.name, t: 's' },                         // D: Наименование
      { v: p.qty, t: 'n' },                          // E: Кол-во
      { v: p.link || '', t: 's' },                   // F: Где закуп
      { v: p.purchasePrice, t: 'n' },                // G: Цена ед.
      { f: `G${r}*E${r}`, v: purchaseSum, t: 'n' },  // H: Цена закупа
      { f: `IF(H${itogExcelRow}=0,0,H${r}/H${itogExcelRow})`, v: pctOfOrder, t: 'n' },        // I: % от заказа
      { f: `I${r}*I2`, v: deliveryShare, t: 'n' },   // J: Доля доставки (I2 = deliveryCost)
      { f: `IF(E${r}=0,G${r},G${r}+J${r}/E${r})`, v: ppWithDel, t: 'n' },  // K: Цена с дост за ед
      { f: `K${r}*E${r}`, v: ppWithDel * p.qty, t: 'n' },          // L: Итого с доставкой
      { v: '', t: 's' },                             // M: пусто
      { f: `K${r}*(1+R2/100)`, v: sellPerUnit, t: 'n' },           // N: Цена продажи за ед (R2=markup)
      { f: `N${r}*E${r}`, v: sellSum, t: 'n' },      // O: Стоимость продажи
    ]);
  });

  // Итого строка
  const firstDataExcel = dataStartRow + 1;
  const lastDataExcel  = dataStartRow + posCount;
  calcRows.push([
    { v: 'Итого', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { f: `SUM(H${firstDataExcel}:H${lastDataExcel})`, v: totalPurchase, t: 'n' },
    { v: '', t: 's' },
    { f: `SUM(J${firstDataExcel}:J${lastDataExcel})`, v: deliveryCost, t: 'n' },
    { v: '', t: 's' },
    { f: `H${itogExcelRow}+J${itogExcelRow}`, v: totalPurchase + deliveryCost, t: 'n' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { f: `SUM(O${firstDataExcel}:O${lastDataExcel})`, v: req.total, t: 'n' },
  ]);

  // Прибыль
  calcRows.push([]);
  const profitRow = Array.from({ length: 15 }, () => ({ v: '', t: 's' }));
  profitRow[13] = { v: 'прибыль', t: 's' };
  profitRow[14] = { f: `O${itogExcelRow}-H${itogExcelRow}-J${itogExcelRow}`, v: req.total - totalPurchase - deliveryCost, t: 'n' };
  calcRows.push(profitRow);

  const ws1 = XLSX.utils.aoa_to_sheet(calcRows);

  // Записываем deliveryCost и markup в именованные ячейки для ссылок в формулах
  // I2 = deliveryCost (строка 1, col 8 = I)
  // R2 = markup (строка 1, col 17 = R)
  ws1['I2'] = { t: 'n', v: deliveryCost };
  ws1['R2'] = { t: 'n', v: markup };

  // ВАЖНО: aoa_to_sheet построил '!ref' только по 15 колонкам (A:O), т.к. все
  // строки массива были такой длины. Ячейка R2 (наценка), от которой зависят
  // формулы "Цена продажи за единицу" (N) и "Стоимость продажи" (O), лежит
  // ЗА пределами этого диапазона — Excel не пересчитывает такие ячейки при
  // открытии и трактует их как пустые (0), из-за чего наценка "терялась" и
  // цена продажи в файле совпадала с ценой закупки. Расширяем диапазон листа,
  // чтобы включить колонку R.
  {
    const ref = XLSX.utils.decode_range(ws1['!ref']);
    ref.e.c = Math.max(ref.e.c, XLSX.utils.decode_col('R'));
    ws1['!ref'] = XLSX.utils.encode_range(ref);
  }

  // Применяем рамки к шапке (строка 3 = индекс 2) + данные + итого
  // ВАЖНО: applyBorders вызывается ПОСЛЕ всех ws1[addr] присвоений,
  // иначе aoa_to_sheet перезапишет ячейки без стилей
  const tableRange = {
    s: { r: 2, c: 0 },
    e: { r: 2 + posCount + 1, c: 14 }
  };
  applyBorders(ws1, tableRange);

  // Жирная шапка
  for (let C = 0; C <= 14; C++) {
    const addr = XLSX.utils.encode_cell({ r: 2, c: C });
    if (!ws1[addr]) ws1[addr] = { t: 's', v: '' };
    if (!ws1[addr].s) ws1[addr].s = {};
    ws1[addr].s.font = { bold: true };
    ws1[addr].s.fill = { fgColor: { rgb: 'D9E1F2' } };
    ws1[addr].s.border = allBorders;
  }

  ws1['!cols'] = [
    {wch:22},{wch:30},{wch:5},{wch:60},{wch:7},{wch:14},{wch:12},
    {wch:14},{wch:10},{wch:12},{wch:18},{wch:18},{wch:4},{wch:18},{wch:18}
  ];
  XLSX.utils.book_append_sheet(wb, ws1, sheetName);

  // ── Лист 2: Спецификация ─────────────────────────────────────────────────
  {
    let specPositions = !isRealization ? req.positions : req.positions.filter(p => {
      const org = (p.rowOrgName || p.comment || '').toLowerCase();
      const ipShort = (req.orgShort || '').toLowerCase();
      return org.includes('рогулькин') || org.includes('ип') || org === ipShort || org === '';
    });

    if (specPositions.length > 0) {
      const specRows = [];
      // Header (строка 0)
      specRows.push(['№ п/п', 'Наименование Товара', 'Кол-во (шт.)', 'Цена за ед., руб. (без НДС)', 'Стоимость, руб. (без НДС)']);

      let specTotal = 0;
      specPositions.forEach((p, i) => {
        const sr = i + 2; // Excel row (1-based, header=1)
        const sellUnit = p.sellPerUnit || p.purchasePrice * (1 + markup / 100);
        const sellSum  = p.sellSum    || sellUnit * p.qty;
        specTotal += sellSum;
        specRows.push([
          { v: i + 1, t: 'n' },
          { v: p.name, t: 's' },
          { v: p.qty, t: 'n' },
          { v: sellUnit, t: 'n' },
          { f: `C${sr}*D${sr}`, v: sellSum, t: 'n' },
        ]);
      });

      const specCount = specPositions.length;
      // Итого строка (индекс specCount + 1 в массиве, т.к. header = 0)
      specRows.push([
        { v: '', t: 's' },
        { v: '', t: 's' },
        { v: '', t: 's' },
        { v: 'Итого:', t: 's' },
        { f: `SUM(E2:E${specCount + 1})`, v: specTotal, t: 'n' },
      ]);
      specRows.push(['', '', '', '', '']);
      specRows.push(['НДС: не облагается', '', '', '', '']);

      const ws2 = XLSX.utils.aoa_to_sheet(specRows);

      // Рамки: шапка (r=0) + данные (r=1..specCount) + итого (r=specCount+1)
      // НЕ включаем строки НДС и пустую — они вне таблицы
      applyBorders(ws2, {
        s: { r: 0, c: 0 },
        e: { r: specCount + 1, c: 4 }
      });

      // Жирная шапка спецификации
      for (let C = 0; C <= 4; C++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c: C });
        if (!ws2[addr]) ws2[addr] = { t: 's', v: '' };
        if (!ws2[addr].s) ws2[addr].s = {};
        ws2[addr].s.font = { bold: true };
        ws2[addr].s.fill = { fgColor: { rgb: 'D9E1F2' } };
        ws2[addr].s.border = allBorders;
      }
      // Жирная строка итого
      for (let C = 0; C <= 4; C++) {
        const addr = XLSX.utils.encode_cell({ r: specCount + 1, c: C });
        if (!ws2[addr]) ws2[addr] = { t: 's', v: '' };
        if (!ws2[addr].s) ws2[addr].s = {};
        ws2[addr].s.font = { bold: true };
        ws2[addr].s.border = allBorders;
      }

      ws2['!cols'] = [{wch:8},{wch:70},{wch:10},{wch:24},{wch:24}];
      XLSX.utils.book_append_sheet(wb, ws2, 'Спецификация');
    }
  }

  const fname = `${req.specNum}_расчёты.xlsx`;
  // If existingWb was passed — caller handles the workbook, skip download
  if (existingWb) return;
  try {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    toast('Скачан: ' + fname);
  } catch(e) {
    console.error('Excel download error:', e);
    toast('Ошибка скачивания: ' + e.message);
  }
}

