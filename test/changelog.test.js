// Тесты на парсер CHANGELOG.md (src/changelog.js). Это регрессия против
// молчаливой поломки формата: если кто-то поменяет структуру заголовков в
// CHANGELOG.md не так, как ожидает парсер, раздел «Последние изменения» на
// странице «О системе» просто молча опустеет — лучше поймать это тестом.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

test('CHANGELOG.md существует и парсится хотя бы в один релиз', () => {
  // require кэширует модуль по require-time чтению файла — здесь просто
  // проверяем результат уже загруженного парсера на реальном файле проекта.
  delete require.cache[require.resolve('../src/changelog')];
  const releases = require('../src/changelog');
  assert.ok(Array.isArray(releases), 'changelog должен быть массивом');
  assert.ok(releases.length > 0, 'должен быть распарсен хотя бы один релиз');
  assert.ok(releases[0].version, 'у релиза должна быть версия');
  assert.ok(releases[0].date, 'у релиза должна быть дата');
  assert.ok(Array.isArray(releases[0].items) && releases[0].items.length > 0, 'у релиза должны быть пункты изменений');
});

test('парсер не падает и возвращает [], если CHANGELOG.md отсутствует', () => {
  // Временно переименовываем файл, чтобы смоделировать его отсутствие —
  // затем гарантированно возвращаем на место, даже при падении теста.
  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  const tmpPath = path.join(os.tmpdir(), 'CHANGELOG.md.bak-' + Date.now());
  const existed = fs.existsSync(changelogPath);
  if (existed) fs.renameSync(changelogPath, tmpPath);
  try {
    delete require.cache[require.resolve('../src/changelog')];
    const releases = require('../src/changelog');
    assert.deepEqual(releases, []);
  } finally {
    if (existed) fs.renameSync(tmpPath, changelogPath);
    delete require.cache[require.resolve('../src/changelog')];
  }
});
