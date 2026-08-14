// Регрессионные тесты на генерацию .docx. Проверяем не «красиво ли выглядит»
// (это не измерить в юнит-тесте), а конкретные баги, которые уже случались:
// - отступ первой строки через `w:ind firstLine` не всегда рендерился в
//   реальном Word при печати → перешли на явный символ табуляции + tabStop;
// - опечатка insideH/insideV вместо insideHorizontal/insideVertical в
//   границах служебных таблиц — библиотека молча игнорировала свойство.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSpecDocx } = require('../src/services/docxService');

const SAMPLE_REQ = {
  specNum: 'П202608-01', orgFull: 'ООО «ТЕСТ»', orgShort: 'ТЕСТ',
  orgSignatory: 'И. И. Иванов', orgStamp: true,
  supplier: 'ИП Тестов Т.Т.', supplierSignatory: 'Т. Т. Тестов', supplierStamp: false,
  contract: 'П-202604-01 от «01» апреля 2026 г.',
  address: 'г. Тест, ул. Тестовая д.1',
  date: '2026-08-13', docType: 'goods',
  positions: [{ name: 'Тестовый товар', qty: 1, unit: 'шт', sellPrice: 1000 }],
};

// docx-архив — это ZIP; без внешней библиотеки для распаковки просто ищем
// сигнатуру `word/document.xml` в сырых байтах и вытаскиваем raw-контент
// упрощённо через встроенный zlib (файлы в docx обычно STORED/DEFLATE).
// Чтобы не тянуть новую зависимость, используем Node built-in zlib + ручной
// разбор ZIP central directory — минимально, но без внешних пакетов.
function extractDocumentXml(buf) {
  const zlib = require('zlib');
  // Ищем local file header с именем 'word/document.xml'
  const marker = Buffer.from('word/document.xml');
  let idx = buf.indexOf(marker);
  assert.ok(idx > -1, 'word/document.xml не найден в docx-архиве');
  // Локальный заголовок ZIP начинается за 30+len(name) байт до найденного имени
  // Формат local file header: сигнатура(4) + версия(2) + флаги(2) + метод(2) +
  // время(2) + дата(2) + crc32(4) + compSize(4) + uncompSize(4) + nameLen(2) + extraLen(2) + имя + extra + данные
  const headerStart = idx - 26; // от начала имени назад до начала fixed-part заголовка (после сигнатуры)
  const sigStart = headerStart - 4;
  assert.equal(buf.readUInt32LE(sigStart), 0x04034b50, 'не найдена сигнатура local file header перед именем');
  const method = buf.readUInt16LE(sigStart + 8);
  const compSize = buf.readUInt32LE(sigStart + 18);
  const nameLen = buf.readUInt16LE(sigStart + 26);
  const extraLen = buf.readUInt16LE(sigStart + 28);
  const dataOffset = sigStart + 30 + nameLen + extraLen;
  const compData = buf.slice(dataOffset, dataOffset + compSize);
  if (method === 0) return compData.toString('utf8'); // STORED
  return zlib.inflateRawSync(compData).toString('utf8'); // DEFLATE
}

test('buildSpecDocx — абзацы после таблицы используют табуляцию, не только w:ind', async () => {
  const buf = await buildSpecDocx(SAMPLE_REQ);
  const xml = extractDocumentXml(buf);

  assert.match(xml, /Настоящая Спецификация составлена/, 'финальный абзац не найден в документе');

  // Каждый информационный абзац должен начинаться с символа табуляции
  // (\t) в тексте и иметь <w:tabs><w:tab .../></w:tabs> в pPr — это и есть
  // «дедовский» способ красной строки, на который сознательно перешли.
  const paraMatch = xml.match(/<w:p>(?:(?!<\/w:p>).)*Срок поставки Товара(?:(?!<\/w:p>).)*<\/w:p>/s);
  assert.ok(paraMatch, 'абзац "Срок поставки Товара" не найден');
  assert.match(paraMatch[0], /<w:tab w:val="left" w:pos="709"\/>/, 'нет табстопа на 709 twips (1.25см)');
  assert.match(paraMatch[0], /<w:t[^>]*>\\tСрок поставки Товара|<w:t[^>]*>\t?Срок поставки Товара/, 'текст абзаца не начинается с символа табуляции');
});

test('buildSpecDocx — служебные таблицы имеют невидимые внутренние границы', async () => {
  const buf = await buildSpecDocx(SAMPLE_REQ);
  const xml = extractDocumentXml(buf);

  // insideH/insideV — это корректные стандартные имена XML-элементов OOXML
  // (не баг сами по себе). Регрессия, которая тут была реально: в JS-коде
  // ключи объекта назывались insideH/insideV вместо insideHorizontal/
  // insideVertical, которые ожидает библиотека `docx` — из-за чего свойство
  // молча игнорировалось и Word подставлял видимую границу по умолчанию.
  // Проверяем результат: у ПЕРВОЙ (служебной, самой верхней) таблицы
  // insideH/insideV должны быть val="none" — то есть невидимые.
  const firstTable = xml.match(/<w:tbl>.*?<\/w:tblPr>/s);
  assert.ok(firstTable, 'первая (служебная) таблица не найдена');
  assert.match(firstTable[0], /<w:insideH w:val="none"/, 'insideH служебной таблицы должен быть невидимым (val="none")');
  assert.match(firstTable[0], /<w:insideV w:val="none"/, 'insideV служебной таблицы должен быть невидимым (val="none")');
});

test('buildSpecDocx — для типа "реализация" нет ссылки на договор и порядка оплаты', async () => {
  const buf = await buildSpecDocx({ ...SAMPLE_REQ, docType: 'realization' });
  const xml = extractDocumentXml(buf);

  assert.doesNotMatch(xml, /Приложение №1/, 'у "реализации" не должно быть ссылки на договор');
  assert.doesNotMatch(xml, /Порядок оплаты/, 'у "реализации" не должно быть порядка оплаты');
  assert.match(xml, /СПЕЦИФИКАЦИЯ НА РЕАЛИЗАЦИЮ/, 'заголовок реализации не найден');
});

test('buildSpecDocx — таблица не шире печатной области страницы', async () => {
  const buf = await buildSpecDocx(SAMPLE_REQ);
  const xml = extractDocumentXml(buf);

  const marginsMatch = xml.match(/<w:pgMar\b[^>]*\/>/);
  const pageSizeMatch = xml.match(/<w:pgSz w:w="(\d+)"/);
  assert.ok(marginsMatch && pageSizeMatch, 'не удалось найти поля/размер страницы в sectPr');

  const leftMatch  = marginsMatch[0].match(/w:left="(\d+)"/);
  const rightMatch = marginsMatch[0].match(/w:right="(\d+)"/);
  assert.ok(leftMatch && rightMatch, 'не удалось извлечь left/right из w:pgMar');

  const pageWidth = parseInt(pageSizeMatch[1], 10);
  const left = parseInt(leftMatch[1], 10);
  const right = parseInt(rightMatch[1], 10);
  const usableWidth = pageWidth - left - right;

  const tableWidthMatch = xml.match(/<w:tblW[^>]*w:w="(\d+)"[^>]*\/>/);
  assert.ok(tableWidthMatch, 'ширина таблицы не найдена');
  const tableWidth = parseInt(tableWidthMatch[1], 10);

  assert.ok(tableWidth <= usableWidth, `таблица (${tableWidth}) шире печатной области (${usableWidth})`);
});
