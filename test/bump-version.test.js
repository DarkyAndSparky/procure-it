// Тесты на scripts/bump-version.js — расчёт следующей версии с авто-
// определением ISO-недели (см. комментарий в CHANGELOG про 26w39-b01:
// раньше номер недели не обновлялся автоматически, приходилось следить
// вручную и один раз забыли на 12 релизов подряд).
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeNext, isoWeekYear } = require('../scripts/bump-version.js');

test('isoWeekYear: совпадает с эталонными датами (включая переход года)', () => {
  // Сверено с Python datetime.date.isocalendar() — см. историю разработки.
  const cases = [
    ['2026-01-01', 2026, 1],
    ['2026-01-05', 2026, 2],
    ['2026-09-21', 2026, 39],
    ['2026-12-28', 2026, 53],
    ['2027-01-04', 2027, 1],
    ['2025-12-29', 2026, 1], // граница года: 29 дек 2025 — уже неделя 1 2026-го по ISO
  ];
  for (const [iso, expectYear, expectWeek] of cases) {
    const [y, m, d] = iso.split('-').map(Number);
    const { isoYear, week } = isoWeekYear(new Date(y, m - 1, d));
    assert.equal(isoYear, expectYear, `${iso}: год`);
    assert.equal(week, expectWeek, `${iso}: неделя`);
  }
});

test('computeNext: та же ISO-неделя — счётчик сборки +1', () => {
  // 2026-09-21 (понедельник) и 2026-09-27 (воскресенье той же недели) —
  // оба должны попадать в w39.
  assert.equal(computeNext('26w39-b01', new Date(2026, 8, 21)), '26w39-b02');
  assert.equal(computeNext('26w39-b02', new Date(2026, 8, 27)), '26w39-b03');
});

test('computeNext: неделя сменилась (понедельник) — новая неделя, счётчик сброшен на 01', () => {
  assert.equal(computeNext('26w39-b07', new Date(2026, 8, 28)), '26w40-b01'); // 28 сен — следующий понедельник
});

test('computeNext: смена года на стыке недель — YY и WW оба обновляются корректно', () => {
  // 2026-12-28 — понедельник, ISO-неделя 53 года 2026. Следующий понедельник
  // (2027-01-04) — уже неделя 1 года 2027.
  assert.equal(computeNext('26w53-b03', new Date(2027, 0, 4)), '27w1-b01');
});

test('computeNext: смена стадии сбрасывает счётчик на 01, даже в той же неделе', () => {
  assert.equal(computeNext('26w39-b05', new Date(2026, 8, 21), 'rc'), '26w39-rc01');
});

test('computeNext: та же неделя и та же стадия, явно переданная — обычный инкремент, не сброс', () => {
  assert.equal(computeNext('26w39-b05', new Date(2026, 8, 21), 'b'), '26w39-b06');
});

test('computeNext: некорректная текущая версия — понятная ошибка, не тихий сбой', () => {
  assert.throws(() => computeNext('not-a-version', new Date()), /не соответствует формату/);
});

test('computeNext: неизвестная стадия — понятная ошибка', () => {
  assert.throws(() => computeNext('26w39-b01', new Date(), 'zz'), /Неизвестная стадия/);
});

test('computeNext: счётчик 99 -> 100 не ломает формат (двузначный минимум, не максимум)', () => {
  // NN в формате — минимум 2 цифры, не ограничение сверху; 99 сборок за
  // неделю маловероятно, но функция не должна тихо обрезать/ломаться.
  assert.equal(computeNext('26w39-b99', new Date(2026, 8, 21)), '26w39-b100');
});
