// Регрессия на "Пользователь" в audit log (ROADMAP_Q4.md §8, 26w36-b20).
// Раньше audit_log вообще не хранил, кто сделал изменение — ни колонки в
// схеме, ни аргумента в auditLog(), ни (что оказалось отдельной находкой)
// рабочего способа узнать текущего пользователя в защищённых write-роутах:
// req.username выставлялся только в authMiddleware(), которая нигде не
// подключена — все реальные роуты идут через requireRole()/operatorOrAdmin,
// которая username не трогала вообще. Живая проверка через curl (создание
// заявки и смена статуса от лица оператора, проверка audit_log) была
// прогнана при разработке; здесь — контракт на уровне схемы и функции.
const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { runMigrations } = require('../src/db/schema');

async function freshDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db);
  return db;
}

test('схема: audit_log.username существует после миграции свежей БД', async () => {
  const db = await freshDb();
  const cols = db.exec(`PRAGMA table_info(audit_log)`)[0].values.map(r => r[1]);
  assert.ok(cols.includes('username'), `ожидалась колонка username, есть: ${cols.join(', ')}`);
});

test('миграция со старой схемы audit_log (без username) добавляет колонку, не теряя данные', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  // Эмулируем БД в состоянии до 26w36-b20.
  db.run(`CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    request_id TEXT, action TEXT NOT NULL,
    field TEXT, old_value TEXT, new_value TEXT, meta TEXT
  )`);
  db.run(`INSERT INTO audit_log (request_id, action) VALUES ('req-1', 'CREATE')`);

  runMigrations(db);

  const cols = db.exec(`PRAGMA table_info(audit_log)`)[0].values.map(r => r[1]);
  assert.ok(cols.includes('username'), 'миграция должна добавить username к существующей таблице');

  const rows = db.exec(`SELECT request_id, action FROM audit_log`)[0].values;
  assert.equal(rows.length, 1, 'старая запись не должна потеряться при миграции');
  assert.deepEqual(rows[0], ['req-1', 'CREATE']);
});

test('auditLog() пишет username в БД, когда он передан', async () => {
  const db = await freshDb();

  const connectionPath = require.resolve('../src/db/connection');
  require.cache[connectionPath] = {
    id: connectionPath, filename: connectionPath, loaded: true,
    exports: {
      run: (sql, params) => { try { db.run(sql, params); return true; } catch(e) { return false; } },
    },
  };
  delete require.cache[require.resolve('../src/db/audit')];
  const { auditLog } = require('../src/db/audit');

  auditLog('CREATE', 'req-42', null, null, 'П202609-01', { name: 'Тест' }, 'masha');

  const row = db.exec(`SELECT request_id, action, username FROM audit_log`)[0].values[0];
  assert.deepEqual(row, ['req-42', 'CREATE', 'masha']);

  delete require.cache[connectionPath];
  delete require.cache[require.resolve('../src/db/audit')];
});

test('auditLog() без username — пишет пустую строку, не падает (обратная совместимость со старыми вызовами)', async () => {
  const db = await freshDb();

  const connectionPath = require.resolve('../src/db/connection');
  require.cache[connectionPath] = {
    id: connectionPath, filename: connectionPath, loaded: true,
    exports: {
      run: (sql, params) => { try { db.run(sql, params); return true; } catch(e) { return false; } },
    },
  };
  delete require.cache[require.resolve('../src/db/audit')];
  const { auditLog } = require('../src/db/audit');

  auditLog('DELETE', 'req-1', null, 'П202609-01', null, { name: 'Тест' }); // без 7-го аргумента

  const row = db.exec(`SELECT username FROM audit_log`)[0].values[0];
  assert.deepEqual(row, ['']);

  delete require.cache[connectionPath];
  delete require.cache[require.resolve('../src/db/audit')];
});
