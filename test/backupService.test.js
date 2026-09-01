// Тест на doBackup() — конкретно на коллизию имени файла, найденную при
// аудите перед слиянием dev→main. До фикса время в имени бралось с
// точностью до МИНУТЫ; два бэкапа в одну и ту же минуту (плановый +
// ручной, или два быстрых ручных подряд) тихо перезаписывали друг друга
// через fs.writeFileSync, без единого предупреждения.
//
// Настраиваемая папка бэкапа (см. resolveBackupDir() в backupService.js)
// берётся из настройки backupFolder в БД — тем же приёмом, что и в других
// тестах (изолированная in-memory БД через require.cache), направляем её
// во временную директорию, а не в реальный data/backups проекта.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const { runMigrations } = require('../src/db/schema');

async function setup() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procure-backup-test-'));
  db.run(`INSERT INTO settings (key, value) VALUES ('backupFolder', ?)`, [tmpDir]);

  const connectionPath = require.resolve('../src/db/connection');
  require.cache[connectionPath] = {
    id: connectionPath, filename: connectionPath, loaded: true,
    exports: { getDb: () => db, saveDb: () => {} },
  };
  delete require.cache[require.resolve('../src/services/backupService')];
  const { doBackup } = require('../src/services/backupService');

  return { tmpDir, doBackup, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

test('doBackup: два вызова подряд создают два РАЗНЫХ файла (регрессия на коллизию имени по минуте)', async () => {
  const { tmpDir, doBackup, cleanup } = await setup();
  try {
    doBackup();
    // Пауза больше секунды — раньше (с точностью до минуты) коллизия была
    // бы гарантирована на любой паузе короче минуты; секундная точность
    // делает коллизию практически исключённой при паузе больше секунды.
    await new Promise(r => setTimeout(r, 1100));
    doBackup();

    const dbFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.db'));
    assert.equal(dbFiles.length, 2, `ожидалось 2 разных файла бэкапа, получено: ${dbFiles.join(', ')}`);
  } finally { cleanup(); }
});

test('doBackup: имя файла содержит секунды (формат HH-MM-SS, не HH-MM)', async () => {
  const { tmpDir, doBackup, cleanup } = await setup();
  try {
    doBackup();
    const dbFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.db'));
    assert.equal(dbFiles.length, 1);
    // zakupki_YYYY-MM-DD_HH-MM-SS.db — три двузначных компонента времени
    assert.match(dbFiles[0], /^zakupki_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/);
  } finally { cleanup(); }
});
