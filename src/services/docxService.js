const { fmtRub, numToWords, MONTHS_GENITIVE } = require('../utils/docFormat');

// Строит .docx спецификации/акта из объекта заявки (camelCase, как отдаёт
// rowToRequest + docxBase64/excelBase64 не участвуют тут — это отдельная
// раскладка в fileLayoutService). Возвращает Promise<Buffer>.
async function buildSpecDocx(r) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
          WidthType, AlignmentType, BorderStyle, VerticalAlign,
          ShadingType, HeadingLevel, TabStopType } = require('docx');

  const total = r.total || 0;
  const months = MONTHS_GENITIVE;

  const dateObj = new Date(r.date || Date.now());
  const dateStr = `«${String(dateObj.getDate()).padStart(2,'0')}» ${months[dateObj.getMonth()]} ${dateObj.getFullYear()} г.`;

  // ── Тип документа: goods (товары) | install (услуги монтажа) | support (заглушка) ──
  const docType = r.docType || 'goods';
  const DOC_LABELS = {
    install: {
      title: 'СПЕЦИФИКАЦИЯ НА ВЫПОЛНЕНИЕ РАБОТ',
      colHeader: 'Наименование работ / услуг',
      contractWord: 'к договору подряда',
      termLine: 'Срок выполнения работ: 14 дней.',
      paymentLine: '— Аванс (предварительная оплата) в размере 100 % от стоимости работ, подлежащих выполнению по настоящей Спецификации.',
      qualityLine: 'Работы должны быть выполнены в соответствии с действующими нормами и правилами, а также требованиями технической документации, и приняты Покупателем по акту выполненных работ.',
      finalLine: 'Настоящая Спецификация составлена в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон и является неотъемлемой частью Договора подряда.',
    },
    support: {
      title: 'ДОКУМЕНТ ПО СОПРОВОЖДЕНИЮ (ЗАГЛУШКА)',
      colHeader: 'Наименование услуги',
      contractWord: 'к договору',
      termLine: '⚠ Формат документа «Сопровождение» ещё не согласован и будет уточнён отдельно.',
      paymentLine: '— Порядок оплаты будет определён после согласования формата документа.',
      qualityLine: 'Данный раздел является заглушкой и будет заменён после уточнения формата документа «Сопровождение».',
      finalLine: 'Настоящий документ — временная заглушка и не является итоговой формой.',
    },
    goods: {
      title: 'СПЕЦИФИКАЦИЯ',
      colHeader: 'Наименование Товара',
      contractWord: 'к договору поставки',
      termLine: 'Срок поставки Товара: 14 дней.',
      paymentLine: '— Аванс (предварительная оплата) в размере 100 % от стоимости Товара, подлежащего поставке по настоящей Спецификации. Цена указана с доставкой до Покупателя.',
      qualityLine: 'Качество Товара должно соответствовать установленным требованиям государственных стандартов качества в соответствии с действующим законодательством Российской Федерации. При поставке необходимо наличие всех необходимых сертификатов, удостоверений качества, протоколов лабораторных испытаний и т.д. на поставляемый Товар.',
      finalLine: 'Настоящая Спецификация составлена в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон и является неотъемлемой частью Договора.',
    },
  };
  const L = DOC_LABELS[docType] || DOC_LABELS.goods;

  const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
  const allBorders = { top: border, bottom: border, left: border, right: border };

  function cell(text, opts = {}) {
    return new TableCell({
      borders: allBorders,
      verticalAlign: VerticalAlign.CENTER,
      width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFFFF' },
      children: [new Paragraph({
        alignment: opts.align || AlignmentType.LEFT,
        children: [new TextRun({ text: String(text||''), size: 22, font: 'Times New Roman', bold: !!opts.bold })]
      })]
    });
  }

  // Table width in DXA (A4 minus margins: ~170mm = 9639 DXA)
  const TW = 9639;
  const colWidths = [545, 5449, 900, 1372, 1373]; // sum = 9639

  // Header row
  const headerRow = new TableRow({ tableHeader: true, cantSplit: true, children: [
    cell('№ п/п',   { width: colWidths[0], align: AlignmentType.CENTER, bold: true }),
    cell(L.colHeader, { width: colWidths[1], bold: true }),
    cell('Кол-во (шт.)',        { width: colWidths[2], align: AlignmentType.CENTER, bold: true }),
    cell('Цена за ед., руб. (без НДС)', { width: colWidths[3], align: AlignmentType.CENTER, bold: true }),
    cell('Стоимость, руб. (без НДС)',   { width: colWidths[4], align: AlignmentType.CENTER, bold: true }),
  ]});

  const dataRows = (r.positions || []).map((p, i) => {
    const rMarkup = (r.markup!==undefined&&r.markup!==null?r.markup:5);
    const sellUnit = p.sellPerUnit || (p.purchasePrice||0)*(1+rMarkup/100);
    const sellSum  = p.sellSum    || sellUnit * p.qty;
    return new TableRow({ cantSplit: true, children: [
      cell(i+1,               { width: colWidths[0], align: AlignmentType.CENTER }),
      cell(p.name||'',        { width: colWidths[1] }),
      cell(p.qty||1,          { width: colWidths[2], align: AlignmentType.CENTER }),
      cell(fmtRub(sellUnit),  { width: colWidths[3], align: AlignmentType.RIGHT }),
      cell(fmtRub(sellSum),   { width: colWidths[4], align: AlignmentType.RIGHT }),
    ]});
  });

  const itogRow = new TableRow({ cantSplit: true, children: [
    cell('', { width: colWidths[0] }),
    cell('', { width: colWidths[1] }),
    cell('', { width: colWidths[2] }),
    cell('Итого:', { width: colWidths[3], align: AlignmentType.RIGHT, bold: true }),
    cell(fmtRub(total), { width: colWidths[4], align: AlignmentType.RIGHT, bold: true }),
  ]});

  const ndsRow = new TableRow({ cantSplit: true, children: [
    new TableCell({ columnSpan: 5, borders: allBorders, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFFFF' },
      children: [new Paragraph({ children: [new TextRun({ text: 'НДС: не облагается', size: 22, font: 'Times New Roman' })] })] })
  ]});

  const specTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows, itogRow, ndsRow]
  });

  function para(text, opts = {}) {
    return new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { before: opts.before || 120, after: opts.after || 0 },
      keepNext: !!opts.keepNext,
      keepLines: !!opts.keepLines,
      children: [new TextRun({
        text, size: opts.size || 22, font: 'Times New Roman',
        bold: !!opts.bold, italics: !!opts.italic
      })]
    });
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, bottom: 1134, left: 1701, right: 850 }, // ~20mm/15mm/30mm/15mm
        }
      },
      children: [
        // Приложение ref — таблица: пустая левая колонка + текст справа (как "колонка Справа" в Word)
        ...((() => {
          const contract = r.contract || '—';
          const fromIdx = contract.indexOf(' от ');
          const contractNum  = fromIdx > -1 ? contract.slice(0, fromIdx) : contract;
          const contractDate = fromIdx > -1 ? 'от ' + contract.slice(fromIdx + 4) : '';
          // Разбиваем на строки столбиком
          const lines = [`Приложение №1`, `${L.contractWord} № ${contractNum}`];
          if (contractDate) lines.push(contractDate);
          const nb = { style: BorderStyle.NONE, size: 0, color: 'auto' };
          const noBorders = { top: nb, bottom: nb, left: nb, right: nb };
          const rightW = Math.round(TW * 0.52); // ~52% — достаточно для текста
          const leftW  = TW - rightW;
          return [new Table({
            width: { size: TW, type: WidthType.DXA },
            columnWidths: [leftW, rightW],
            borders: { top: nb, bottom: nb, left: nb, right: nb, insideH: nb, insideV: nb },
            rows: [new TableRow({ children: [
              new TableCell({ borders: noBorders, children: [new Paragraph({ children: [] })] }),
              new TableCell({ borders: noBorders, children: lines.map((line, i) => new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 0, after: i === lines.length - 1 ? 80 : 0 },
                children: [new TextRun({ text: line, size: 20, font: 'Times New Roman', color: '555555' })]
              })) }),
            ]})],
          })];
        })()),
        // Заголовок
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
          children: [new TextRun({ text: `${L.title} № ${r.specNum||''}`, size: 26, bold: true, font: 'Times New Roman' })]
        }),
        // Город / дата
        new Table({
          width: { size: TW, type: WidthType.DXA },
          columnWidths: [TW/2, TW/2],
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
          rows: [new TableRow({ children: [
            new TableCell({ borders: { top:{style:BorderStyle.NONE}, bottom:{style:BorderStyle.NONE}, left:{style:BorderStyle.NONE}, right:{style:BorderStyle.NONE} }, children: [new Paragraph({ children: [new TextRun({ text: 'г. Екатеринбург', size: 22, font: 'Times New Roman' })] })] }),
            new TableCell({ borders: { top:{style:BorderStyle.NONE}, bottom:{style:BorderStyle.NONE}, left:{style:BorderStyle.NONE}, right:{style:BorderStyle.NONE} }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: dateStr, size: 22, font: 'Times New Roman' })] })] }),
          ]})]
        }),
        new Paragraph({ spacing: { before: 160, after: 0 }, children: [] }),
        // Таблица
        specTable,
        // Текст
        para(`Всего наименований ${(r.positions||[]).length}, на сумму ${fmtRub(total)} рублей, без НДС`, { before: 180, keepNext: true }),
        new Paragraph({
          spacing: { before: 80, after: 0 },
          children: [new TextRun({ text: `${numToWords(total)}, НДС не облагается.`, size: 22, font: 'Times New Roman', italics: true })]
        }),
        para(L.termLine, { before: 160 }),
        new Paragraph({ spacing: { before: 120, after: 0 }, children: [new TextRun({ text: 'Порядок оплаты:', size: 22, font: 'Times New Roman', bold: true })] }),
        para(L.paymentLine, { before: 80 }),
        ...(r.address ? [para(`${docType==='install' ? 'Адрес выполнения работ' : 'Адрес доставки/выборки'}: ${r.address}`, { before: 80 })] : []),
        para(L.qualityLine, { before: 80 }),
        para(L.finalLine, { before: 80 }),
        // Подписи — без таблицы: два столбца через табуляцию, чтобы в Word
        // не было вообще никакого табличного объекта (и, соответственно, рамки/сетки)
        // keepNext/keepLines на всех параграфах блока подписей, кроме последнего,
        // чтобы Word не разрывал этот блок между страницами (актуально при большом
        // числе позиций, когда таблица занимает много страниц и конец документа
        // может случайно попасть на границу страницы).
        new Paragraph({ spacing: { before: 300, after: 0 }, keepNext: true, keepLines: true, children: [] }),
        new Paragraph({
          tabStops: [{ type: TabStopType.LEFT, position: TW/2 }],
          keepNext: true, keepLines: true,
          children: [
            new TextRun({ text: 'Поставщик:', size: 22, font: 'Times New Roman', bold: true }),
            new TextRun({ text: '\tПокупатель:', size: 22, font: 'Times New Roman', bold: true }),
          ]
        }),
        new Paragraph({
          spacing: { before: 120 },
          tabStops: [{ type: TabStopType.LEFT, position: TW/2 }],
          keepNext: true, keepLines: true,
          children: [
            new TextRun({ text: r.supplier || '___________', size: 22, font: 'Times New Roman', bold: true }),
            new TextRun({ text: `\t${r.orgFull || '___________'}`, size: 22, font: 'Times New Roman', bold: true }),
          ]
        }),
        new Paragraph({
          spacing: { before: 480 },
          tabStops: [{ type: TabStopType.LEFT, position: TW/2 }],
          keepNext: true, keepLines: true,
          children: [
            new TextRun({ text: `______________________/${r.supplierSignatory || '___________'}/`, size: 22, font: 'Times New Roman' }),
            new TextRun({ text: `\t______________________/${r.orgSignatory || '___________'}/`, size: 22, font: 'Times New Roman' }),
          ]
        }),
        new Paragraph({
          spacing: { before: 80 },
          tabStops: [{ type: TabStopType.LEFT, position: TW/2 }],
          keepLines: true,
          children: [
            new TextRun({ text: r.supplierStamp ? 'М.П.' : 'Б.П.', size: 22, font: 'Times New Roman' }),
            new TextRun({ text: `\t${r.orgStamp === false ? 'Б.П.' : 'М.П.'}`, size: 22, font: 'Times New Roman' }),
          ]
        }),
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildSpecDocx };
