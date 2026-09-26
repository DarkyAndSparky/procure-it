// Тесты на isValidStatusTransition() — матрица переходов статуса заявки,
// добавленная по ROADMAP_Q4.md §7 «Жизненный цикл заявки» (26w36-b19).
//
// Закрепляем контракт на уровне чистой функции (как и validatePositions() в
// test/requests-validation.test.js) — она используется в ДВУХ местах
// (PATCH /requests/:id/status и PUT /requests/:id), и именно рассинхрон
// между этими двумя местами был причиной, по которой полное редактирование
// заявки могло обойти матрицу, если проверять только PATCH. Живая проверка
// через curl на реальном сервере — HTTP-уровня (оба роута, operator и
// admin) — была прогнана вручную при разработке; здесь — контракт самой
// функции, чтобы будущие правки одного из двух вызовов не разошлись молча.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidStatusTransition, STATUS_TRANSITIONS } = require('../src/routes/requests');

test('isValidStatusTransition: одинаковый статус — всегда true (no-op, не переход)', () => {
  for (const s of Object.keys(STATUS_TRANSITIONS)) {
    assert.equal(isValidStatusTransition(s, s, 'operator'), true, `${s} -> ${s}`);
  }
});

test('isValidStatusTransition: разрешённые переходы из матрицы — true для operator', () => {
  for (const [from, tos] of Object.entries(STATUS_TRANSITIONS)) {
    for (const to of tos) {
      assert.equal(isValidStatusTransition(from, to, 'operator'), true, `${from} -> ${to} должен быть разрешён`);
    }
  }
});

test('isValidStatusTransition: new -> delivered (пропуск шагов) — false для operator', () => {
  assert.equal(isValidStatusTransition('new', 'delivered', 'operator'), false);
});

test('isValidStatusTransition: терминальные статусы (delivered/cancelled) — никуда для operator', () => {
  for (const to of Object.keys(STATUS_TRANSITIONS)) {
    if (to === 'delivered') continue;
    assert.equal(isValidStatusTransition('delivered', to, 'operator'), false, `delivered -> ${to}`);
  }
  for (const to of Object.keys(STATUS_TRANSITIONS)) {
    if (to === 'cancelled') continue;
    assert.equal(isValidStatusTransition('cancelled', to, 'operator'), false, `cancelled -> ${to}`);
  }
});

test('isValidStatusTransition: admin обходит матрицу — любой переход true', () => {
  assert.equal(isValidStatusTransition('delivered', 'new', 'admin'), true);
  assert.equal(isValidStatusTransition('cancelled', 'delivered', 'admin'), true);
  assert.equal(isValidStatusTransition('new', 'delivered', 'admin'), true);
});

test('isValidStatusTransition: viewer (не должен даже дойти сюда за роутом, но функция сама по себе не даёт обхода)', () => {
  assert.equal(isValidStatusTransition('new', 'delivered', 'viewer'), false);
});
