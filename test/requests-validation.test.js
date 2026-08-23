// Тесты на две функции, недавно затронутые аудитом перед слиянием
// dev→main и до этого не покрытые автотестами (только проверялись вручную
// через curl):
//
// 1. validatePositions() — раньше была продублирована между POST и PUT
//    /requests с разной строгостью (PUT не проверял поля позиций вообще),
//    вынесена в общую функцию. Тесты закрепляют контракт, чтобы create и
//    update не смогли разойтись снова незаметно.
// 2. rowToRequest() — JSON.parse(positions) получил try/catch с fallback
//    на [] (один битый ряд в БД раньше ронял весь список реестра, не
//    только одну заявку).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePositions } = require('../src/routes/requests');
const { rowToRequest } = require('../src/db/connection');

test('validatePositions: undefined — не ошибка (позиции необязательны)', () => {
  assert.equal(validatePositions(undefined), null);
});

test('validatePositions: не массив — ошибка', () => {
  assert.match(validatePositions('не массив'), /массивом/);
  assert.match(validatePositions({ name: 'x' }), /массивом/);
});

test('validatePositions: пустой массив — валиден', () => {
  assert.equal(validatePositions([]), null);
});

test('validatePositions: корректные позиции — валидны', () => {
  assert.equal(validatePositions([{ name: 'Товар', qty: 5, purchasePrice: 100 }]), null);
});

test('validatePositions: name не строка — ошибка', () => {
  assert.match(validatePositions([{ name: 123, qty: 1 }]), /name/);
  assert.match(validatePositions([{ qty: 1 }]), /name/); // name вообще отсутствует
});

test('validatePositions: отрицательное qty — ошибка', () => {
  assert.match(validatePositions([{ name: 'Товар', qty: -5 }]), /кол-во/i);
});

test('validatePositions: qty не число (NaN после приведения) — ошибка', () => {
  assert.match(validatePositions([{ name: 'Товар', qty: 'много' }]), /кол-во/i);
});

test('validatePositions: qty=0 — валиден (граничное значение)', () => {
  assert.equal(validatePositions([{ name: 'Товар', qty: 0 }]), null);
});

test('validatePositions: qty не указан вообще — валиден (необязательное поле)', () => {
  assert.equal(validatePositions([{ name: 'Товар' }]), null);
});

test('validatePositions: purchasePrice не число — ошибка', () => {
  assert.match(validatePositions([{ name: 'Товар', purchasePrice: 'дорого' }]), /цена/i);
});

test('validatePositions: одна плохая позиция среди хороших — вся операция отклоняется', () => {
  const err = validatePositions([
    { name: 'Хорошая', qty: 1 },
    { name: 'Плохая', qty: -1 },
    { name: 'Тоже хорошая', qty: 2 },
  ]);
  assert.match(err, /кол-во/i);
});

test('rowToRequest: корректный JSON в positions парсится как массив', () => {
  const row = { id: '1', name: 'Тест', positions: '[{"name":"Товар","qty":5}]' };
  const r = rowToRequest(row);
  assert.deepEqual(r.positions, [{ name: 'Товар', qty: 5 }]);
});

test('rowToRequest: positions отсутствует (null/undefined) — пустой массив, не падает', () => {
  const r1 = rowToRequest({ id: '1', name: 'Тест', positions: null });
  assert.deepEqual(r1.positions, []);
  const r2 = rowToRequest({ id: '2', name: 'Тест', positions: undefined });
  assert.deepEqual(r2.positions, []);
});

test('rowToRequest: битый JSON в positions — не бросает исключение, отдаёт []', () => {
  const row = { id: 'req-broken', name: 'Тест', positions: '{битый json НЕ ПАРСИТСЯ' };
  assert.doesNotThrow(() => rowToRequest(row));
  const r = rowToRequest(row);
  assert.deepEqual(r.positions, []);
});

test('rowToRequest: positions — валидный JSON, но не массив (объект/строка/число) — отдаёт []', () => {
  assert.deepEqual(rowToRequest({ id: '1', name: 'т', positions: '{"not":"an array"}' }).positions, []);
  assert.deepEqual(rowToRequest({ id: '2', name: 'т', positions: '"просто строка"' }).positions, []);
  assert.deepEqual(rowToRequest({ id: '3', name: 'т', positions: '42' }).positions, []);
});

test('rowToRequest: null row — возвращает null, не бросает исключение', () => {
  assert.equal(rowToRequest(null), null);
});
