const { fmtRub, numToWords, MONTHS_GENITIVE } = require('../utils/docFormat');

// Строит .docx спецификации/акта из объекта заявки (camelCase, как отдаёт
// rowToRequest + docxBase64/excelBase64 не участвуют тут — это отдельная
// раскладка в fileLayoutService). Возвращает Promise<Buffer>.
async function buildSpecDocx(r) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
          WidthType, AlignmentType, BorderStyle, VerticalAlign,
          ShadingType, TabStopType } = require('docx');

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
      paymentLine: 'Аванс (предварительная оплата) в размере 100 % от стоимости работ, подлежащих выполнению по настоящей Спецификации.',
      qualityLine: 'Работы должны быть выполнены в соответствии с действующими нормами и правилами, а также требованиями технической документации, и приняты Покупателем по акту выполненных работ.',
      finalLine: 'Настоящая Спецификация составлена в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон и является неотъемлемой частью Договора подряда.',
    },
    support: {
      title: 'АКТ ГАРАНТИЙНОГО ОБСЛУЖИВАНИЯ',
      colHeader: 'Наименование Товара',
      contractWord: 'к договору поставки',
      termLine: `Гарантийный срок обслуживания: ${'{{WARRANTY}}'} с даты поставки Товара, указанного в настоящем Акте.`,
      qualityLine: 'В течение гарантийного срока Исполнитель обязуется за свой счёт устранять недостатки Товара, возникшие не по вине Покупателя. Гарантия не распространяется на повреждения, возникшие вследствие нарушения правил эксплуатации, механических повреждений, а также естественного износа комплектующих.',
      finalLine: 'Настоящий Акт составлен в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.',
      noPayment: true, // гарантийное обслуживание в рамках срока — бесплатно, блок «Порядок оплаты» не нужен
    },
    goods: {
      title: 'СПЕЦИФИКАЦИЯ',
      colHeader: 'Наименование Товара',
      contractWord: 'к договору поставки',
      termLine: 'Срок поставки Товара: 14 дней.',
      paymentLine: 'Аванс (предварительная оплата) в размере 100 % от стоимости Товара, подлежащего поставке по настоящей Спецификации. Цена указана с доставкой до Покупателя.',
      qualityLine: 'Качество Товара должно соответствовать установленным требованиям государственных стандартов качества в соответствии с действующим законодательством Российской Федерации. При поставке необходимо наличие всех необходимых сертификатов, удостоверений качества, протоколов лабораторных испытаний и т.д. на поставляемый Товар.',
      finalLine: 'Настоящая Спецификация составлена в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон и является неотъемлемой частью Договора.',
    },
    realization: {
      title: 'СПЕЦИФИКАЦИЯ НА РЕАЛИЗАЦИЮ',
      colHeader: 'Наименование Товара',
      contractWord: 'к договору поставки',
      termLine: 'Срок поставки Товара: 14 дней.',
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

  // Table width in DXA — должна точно совпадать с печатной областью
  // страницы (A4 минус поля секции: left 1701 + right 850), иначе таблица
  // на ~5мм вылезает за правое поле. A4 = 11906 DXA; 11906-1701-850=9355.
  const TW = 9355;
  const colWidths = [529, 5289, 874, 1331, 1332]; // sum = 9355

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

  const PARA_FIRST_LINE_INDENT = 709; // ~1.25cm — стандартная «красная строка»

  // Красная строка — через явный символ табуляции + табстоп, а не через
  // свойство `w:ind firstLine`. С ind-свойством были случаи, когда реальный
  // Word при печати игнорировал отступ (хотя XML был корректен и корректно
  // рендерился в LibreOffice/PDF) — а таб-символ с табстопом работает
  // предсказуемо во вообще любой версии Word, это классический способ
  // делать «красную строку» в старых шаблонах документов.
  function para(text, opts = {}) {
    return new Paragraph({
      alignment: opts.align || AlignmentType.BOTH,
      spacing: { before: opts.before || 120, after: opts.after || 0 },
      tabStops: [{ type: TabStopType.LEFT, position: PARA_FIRST_LINE_INDENT }],
      keepNext: !!opts.keepNext,
      keepLines: !!opts.keepLines,
      children: [new TextRun({
        text: '\t' + text, size: opts.size || 22, font: 'Times New Roman',
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
        // Для «Реализации» — товар для себя, договора нет, блок не выводим.
        ...(docType === 'realization' ? [] : (() => {
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
            borders: { top: nb, bottom: nb, left: nb, right: nb, insideHorizontal: nb, insideVertical: nb },
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
        (() => {
          const nb2 = { style: BorderStyle.NONE, size: 0, color: 'auto' };
          const noBorders2 = { top: nb2, bottom: nb2, left: nb2, right: nb2 };
          return new Table({
            width: { size: TW, type: WidthType.DXA },
            columnWidths: [TW/2, TW/2],
            borders: { top: nb2, bottom: nb2, left: nb2, right: nb2, insideHorizontal: nb2, insideVertical: nb2 },
            rows: [new TableRow({ children: [
              new TableCell({ borders: noBorders2, children: [new Paragraph({ children: [new TextRun({ text: 'г. Екатеринбург', size: 22, font: 'Times New Roman' })] })] }),
              new TableCell({ borders: noBorders2, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: dateStr, size: 22, font: 'Times New Roman' })] })] }),
            ]})],
          });
        })(),
        new Paragraph({ spacing: { before: 160, after: 0 }, children: [] }),
        // Таблица
        specTable,
        // Текст
        para(`Всего наименований ${(r.positions||[]).length}, на сумму ${fmtRub(total)} рублей, без НДС`, { before: 180, keepNext: true }),
        new Paragraph({
          alignment: AlignmentType.BOTH,
          spacing: { before: 80, after: 0 },
          tabStops: [{ type: TabStopType.LEFT, position: PARA_FIRST_LINE_INDENT }],
          children: [new TextRun({ text: `\t${numToWords(total)}, НДС не облагается.`, size: 22, font: 'Times New Roman', italics: true })]
        }),
        para(L.termLine.replace('{{WARRANTY}}', r.warrantyPeriod || '12 месяцев'), { before: 160 }),
        // «Порядок оплаты» не актуален для «Реализации» (товар для себя) и
        // «Сопровождения» (гарантийное обслуживание в рамках срока бесплатно).
        ...(docType === 'realization' || L.noPayment ? [] : [
          new Paragraph({ alignment: AlignmentType.BOTH, spacing: { before: 120, after: 0 }, tabStops: [{ type: TabStopType.LEFT, position: PARA_FIRST_LINE_INDENT }], children: [new TextRun({ text: '\tПорядок оплаты:', size: 22, font: 'Times New Roman', bold: true })] }),
          para(L.paymentLine, { before: 80 }),
        ]),
        ...(r.address ? [para(`${docType==='install' ? 'Адрес выполнения работ' : 'Адрес доставки/выборки'}: ${r.address}`, { before: 80 })] : []),
        para(L.qualityLine, { before: 80 }),
        para(L.finalLine, { before: 80 }),
        // Подписи — без таблицы: два столбца через табуляцию, чтобы в Word
        // не было вообще никакого табличного объекта (и, соответственно, рамки/сетки)
        // keepNext/keepLines на всех параграфах блока подписей, кроме последнего,
        // чтобы Word не разрывал этот блок между страницами (актуально при большом
        // числе позиций, когда таблица занимает много страниц и конец документа
        // может случайно попасть на границу страницы).
        ...(docType === 'realization' ? [
          // Реализация — одна сторона (товар для себя), без «Поставщик/Покупатель».
          new Paragraph({ spacing: { before: 300, after: 0 }, keepNext: true, keepLines: true, children: [] }),
          new Paragraph({
            keepNext: true, keepLines: true,
            children: [new TextRun({ text: r.orgFull || '___________', size: 22, font: 'Times New Roman', bold: true })]
          }),
          new Paragraph({
            spacing: { before: 480 },
            keepNext: true, keepLines: true,
            children: [new TextRun({ text: `______________________/${r.orgSignatory || '___________'}/`, size: 22, font: 'Times New Roman' })]
          }),
          new Paragraph({
            spacing: { before: 80 },
            keepLines: true,
            children: [new TextRun({ text: r.orgStamp === false ? 'Б.П.' : 'М.П.', size: 22, font: 'Times New Roman' })]
          }),
        ] : [
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
        ]),
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildSpecDocx };
