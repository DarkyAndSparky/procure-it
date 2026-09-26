// Тесты на buildPeriodFilter() — фильтр периода для Dashboard
// (ROADMAP_Q4.md §11, 26w36-b25). Проверяем контракт функции: какой SQL и
// какие параметры она возвращает для каждого периода. Полный сценарий
// (реальные данные, /api/stats?period=...) прогонялся вживую через curl
// при разработке — здесь фиксируем логику границ, которую проще сломать
// незаметно при будущей правке, чем поймать глазами.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPeriodFilter } = require('../src/routes/requests');

test('buildPeriodFilter: без периода — пустой фильтр (весь период)', () => {
  const { where, params } = buildPeriodFilter(undefined);
  assert.equal(where, '');
  assert.deepEqual(params, []);
});

test('buildPeriodFilter: нераспознанный период — тоже весь период, не ошибка', () => {
  const { where, params } = buildPeriodFilter('декада');
  assert.equal(where, '');
  assert.deepEqual(params, []);
});

test('buildPeriodFilter: today — диапазон из одной даты (сегодня..сегодня)', () => {
  const { where, params } = buildPeriodFilter('today');
  assert.match(where, /date >= \? AND date <= \?/);
  assert.equal(params.length, 2);
  assert.equal(params[0], params[1], 'today: from и to должны совпадать');
  assert.match(params[0], /^\d{4}-\d{2}-\d{2}$/);
});

test('buildPeriodFilter: week — ровно 7 дней включительно (today - 6 = from)', () => {
  const { params } = buildPeriodFilter('week');
  const from = new Date(params[0]);
  const to = new Date(params[1]);
  const diffDays = Math.round((to - from) / (1000 * 60 * 60 * 24));
  assert.equal(diffDays, 6, 'от "from" до "to" должно быть ровно 6 дней разницы (7 дней включительно)');
});

test('buildPeriodFilter: month — LIKE по текущему году-месяцу', () => {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const { where, params } = buildPeriodFilter('month');
  assert.match(where, /date LIKE \?/);
  assert.deepEqual(params, [ym + '%']);
});

test('buildPeriodFilter: year — LIKE по текущему году', () => {
  const now = new Date();
  const { where, params } = buildPeriodFilter('year');
  assert.match(where, /date LIKE \?/);
  assert.deepEqual(params, [`${now.getFullYear()}%`]);
});

test('buildPeriodFilter: quarter — начало текущего календарного квартала (1 число месяца, кратного 3)', () => {
  const now = new Date();
  const { where, params } = buildPeriodFilter('quarter');
  assert.match(where, /date >= \?/);
  const from = new Date(params[0]);
  assert.equal(from.getDate(), 1, 'квартал должен начинаться с 1-го числа месяца');
  assert.equal(from.getMonth() % 3, 0, 'месяц начала квартала должен быть кратен 3 (0-индексация: 0, 3, 6, 9)');
  assert.ok(from <= now, 'начало текущего квартала не может быть в будущем');
});
