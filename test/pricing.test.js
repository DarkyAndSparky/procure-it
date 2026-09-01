// Тесты на формулу расчёта цены продажи — прогоняются `node --test test/`.
// Основано на реальных данных из проверенного вручную файла (см. историю
// фиксов округления в save-export.js): 3 позиции, доставка 650₽.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcRowPricing, calcProfit } = require('../public/js/pricing-core');

test('calcRowPricing — без доставки, наценка 5%', () => {
  const r = calcRowPricing({ purchasePrice: 1000, qty: 2, totalPurchase: 2000, deliveryCost: 0, markup: 0.05 });
  assert.equal(r.purchaseSum, 2000);
  assert.equal(r.deliveryShare, 0);
  assert.equal(r.ppWithDelivery, 1000);
  assert.equal(r.sellPerUnit, 1050);
  assert.equal(r.sellSum, 2100);
});

test('calcRowPricing — реальные данные (ноутбук/мышь/сумка, доставка 650)', () => {
  // Из проверенного вручную файла: закуп 56010+797+999=57806, доставка 650
  const totalPurchase = 56010 + 797 + 999;
  const laptop = calcRowPricing({ purchasePrice: 56010, qty: 1, totalPurchase, deliveryCost: 650, markup: 0 });
  // Доля доставки ноутбука: 56010/57806*650 ≈ 629.80
  assert.equal(laptop.deliveryShare, 629.8);
  assert.equal(laptop.ppWithDelivery, 56639.8);
});

test('calcRowPricing — qty=0 не должен делить на ноль', () => {
  const r = calcRowPricing({ purchasePrice: 500, qty: 0, totalPurchase: 500, deliveryCost: 100, markup: 0 });
  assert.equal(Number.isFinite(r.ppWithDelivery), true);
  assert.equal(r.ppWithDelivery, 500); // при qty=0 доставку некуда положить — берём чистую закупочную цену
});

test('calcRowPricing — totalPurchase=0 не должен делить на ноль', () => {
  const r = calcRowPricing({ purchasePrice: 0, qty: 1, totalPurchase: 0, deliveryCost: 300, markup: 0 });
  assert.equal(r.pctOfOrder, 0);
  assert.equal(r.deliveryShare, 0);
});

test('calcRowPricing — округление до 2 знаков (регрессия на длинные хвосты дробей)', () => {
  // Раньше округление отсутствовало и получалось 56639.8048645469
  const r = calcRowPricing({ purchasePrice: 56010, qty: 1, totalPurchase: 57806, deliveryCost: 650, markup: 0 });
  const decimals = String(r.ppWithDelivery).split('.')[1] || '';
  assert.ok(decimals.length <= 2, `ожидали максимум 2 знака после запятой, получили: ${r.ppWithDelivery}`);
});

test('calcProfit — доставка без позиций не уводит в минус', () => {
  // Регрессия: раньше при totalPurchase=0 и deliveryCost=100 прибыль была -100
  const p = calcProfit({ totalPurchase: 0, totalSell: 0, deliveryCost: 100 });
  assert.equal(p, 0);
});

test('calcProfit — обычный случай', () => {
  const p = calcProfit({ totalPurchase: 1000, totalSell: 1200, deliveryCost: 50 });
  assert.equal(p, 150);
});
