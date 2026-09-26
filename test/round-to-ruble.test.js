// Тесты на «округление до рубля» (roundToRuble) — цена продажи за единицу
// округляется вверх до целого рубля ДО умножения на количество, сумма
// строки = округлённая цена × qty. Требование пользователя: значения на
// сайте, в Excel (оба листа) и в DOCX-спецификации должны совпадать.
// Единственная точка правды — pricing-core.js#calcRowPricing(); сервер
// (computeAuthoritativeTotals) авторитетно перезаписывает p.sellPerUnit/
// p.sellSum в позициях перед сохранением — Excel/DOCX читают уже готовое,
// поэтому не нуждаются в отдельных тестах на согласованность значений (её
// гарантирует то, что источник один). Формулы Excel-листа «Расчёты»
// (CEILING вместо ROUND) проверены отдельно вживую генерацией реального
// .xlsx при разработке — не автоматизировано здесь, т.к. требует browser-
// like окружения с записью стилей, которое недоступно в этой тестовой среде.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcRowPricing } = require('../public/js/pricing-core.js');
const { computeAuthoritativeTotals } = require('../src/routes/requests.js');

test('calcRowPricing: пример пользователя — 2×1400.13 → 1401/шт → 2802.00 сумма', () => {
  const r = calcRowPricing({ purchasePrice: 1400.13, qty: 2, totalPurchase: 2800.26, deliveryCost: 0, markup: 0, roundToRuble: true });
  assert.equal(r.sellPerUnit, 1401);
  assert.equal(r.sellSum, 2802);
});

test('calcRowPricing: roundToRuble=false (по умолчанию) — поведение не меняется', () => {
  const r = calcRowPricing({ purchasePrice: 1400.13, qty: 2, totalPurchase: 2800.26, deliveryCost: 0, markup: 0 });
  assert.equal(r.sellPerUnit, 1400.13);
  assert.equal(r.sellSum, 2800.26);
});

test('calcRowPricing: уже целая цена (1400 ровно) не "перепрыгивает" на 1401 из-за float-погрешности', () => {
  const r = calcRowPricing({ purchasePrice: 1400, qty: 3, totalPurchase: 4200, deliveryCost: 0, markup: 0, roundToRuble: true });
  assert.equal(r.sellPerUnit, 1400);
  assert.equal(r.sellSum, 4200);
});

test('calcRowPricing: доставка тоже округляется вверх ДО распределения по позициям', () => {
  const r = calcRowPricing({ purchasePrice: 100, qty: 1, totalPurchase: 100, deliveryCost: 50.01, markup: 0, roundToRuble: true });
  assert.equal(r.effectiveDeliveryCost, 51, 'доставка 50.01 должна округлиться до 51 ДО распределения');
  assert.equal(r.deliveryShare, 51);
  assert.equal(r.sellPerUnit, 151);
});

test('calcRowPricing: копейка сверху всё равно уходит в следующий рубль (1000.01 -> 1001)', () => {
  const r = calcRowPricing({ purchasePrice: 1000.01, qty: 1, totalPurchase: 1000.01, deliveryCost: 0, markup: 0, roundToRuble: true });
  assert.equal(r.sellPerUnit, 1001);
});

test('calcRowPricing: закупочная сторона (purchaseSum, ppWithDelivery) НЕ округляется даже в roundToRuble — только сторона продажи', () => {
  const r = calcRowPricing({ purchasePrice: 1400.13, qty: 2, totalPurchase: 2800.26, deliveryCost: 0, markup: 0, roundToRuble: true });
  assert.equal(r.purchaseSum, 2800.26, 'закупка — точные деньги поставщику, округлять нельзя');
  assert.equal(r.ppWithDelivery, 1400.13);
});

test('computeAuthoritativeTotals: перезаписывает p.sellPerUnit/p.sellSum в позициях при roundToRuble', () => {
  const positions = [{ name: 'item', qty: 2, purchasePrice: 1400.13, sellPerUnit: 999, sellSum: 999 }]; // заведомо неверные значения, как будто прислал устаревший клиент
  const r = { positions, deliveryCost: 0, markup: 0, roundToRuble: true, totalPurchase: 0, total: 0 };
  const { totalPurchase, total } = computeAuthoritativeTotals('test-id', r);
  assert.equal(total, 2802, 'итог заявки должен быть авторитетно пересчитан сервером');
  assert.equal(positions[0].sellPerUnit, 1401, 'сервер должен перезаписать sellPerUnit в самой позиции (это читают Excel/DOCX)');
  assert.equal(positions[0].sellSum, 2802, 'сервер должен перезаписать sellSum в самой позиции');
});

test('computeAuthoritativeTotals: без roundToRuble поведение как раньше (не округляет)', () => {
  const positions = [{ name: 'item', qty: 2, purchasePrice: 1400.13 }];
  const r = { positions, deliveryCost: 0, markup: 0, totalPurchase: 0, total: 0 };
  const { total } = computeAuthoritativeTotals('test-id', r);
  assert.equal(total, 2800.26);
  assert.equal(positions[0].sellPerUnit, 1400.13);
});
