// Регрессионные тесты на схему БД. Основной сценарий — тот самый баг,
// который уже случался в проде: spec_num был уникален ГЛОБАЛЬНО, из-за чего
// две разные организации не могли получить одинаковый номер спецификации в
// одном месяце (что нормально и ожидаемо). Тест воспроизводит и свежую
// установку, и миграцию существующей БД со старой схемой.
const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { runMigrations } = require('../src/db/schema');

async function freshDb() {
  const SQL = await initSqlJs();
  return new SQL.Database();
}

test('свежая БД: spec_num уникален в рамках (org_id, spec_num), не глобально', async () => {
  const db = await freshDb();
  runMigrations(db);

  db.run(`INSERT INTO requests (id, spec_num, org_id, name) VALUES ('1','П202608-01','org-a','test1')`);
  db.run(`INSERT INTO requests (id, spec_num, org_id, name) VALUES ('2','П202608-01','org-b','test2')`);

  const rows = db.exec('SELECT id, org_id FROM requests ORDER BY id');
  assert.equal(rows[0].values.length, 2, 'одинаковый номер у РАЗНЫХ организаций должен допускаться');

  assert.throws(() => {
    db.run(`INSERT INTO requests (id, spec_num, org_id, name) VALUES ('3','П202608-01','org-a','test3-dup')`);
  }, /UNIQUE/i, 'повторный номер у ТОЙ ЖЕ организации должен быть запрещён');
});

test('миграция со старой схемы (глобальный UNIQUE на spec_num) сохраняет данные и меняет область уникальности', async () => {
  const db = await freshDb();

  // Эмулируем БД в старом (доисторическом) состоянии — до перехода на
  // составной UNIQUE(org_id, spec_num).
  db.run(`CREATE TABLE requests (
    id TEXT PRIMARY KEY, spec_num TEXT NOT NULL UNIQUE,
    org_id TEXT, org_full TEXT, org_short TEXT, org_signatory TEXT,
    bitrix TEXT DEFAULT '', name TEXT NOT NULL, mol TEXT DEFAULT '',
    date TEXT DEFAULT '', address TEXT DEFAULT '', supplier TEXT DEFAULT '', invoice_num TEXT DEFAULT '',
    contract TEXT DEFAULT '', status TEXT DEFAULT 'new', comment TEXT DEFAULT '',
    is_realization INTEGER DEFAULT 0, delivery_cost REAL DEFAULT 0,
    markup REAL DEFAULT 5, total_purchase REAL DEFAULT 0, total REAL DEFAULT 0,
    positions TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`INSERT INTO requests (id, spec_num, org_id, name) VALUES ('old-1','П202608-01','org-legacy','legacy request')`);

  runMigrations(db);

  // Старые данные должны пережить пересборку таблицы
  const preserved = db.exec(`SELECT name FROM requests WHERE id='old-1'`);
  assert.equal(preserved[0].values[0][0], 'legacy request', 'данные из старой схемы должны сохраниться после миграции');

  // И область уникальности теперь должна быть составной
  db.run(`INSERT INTO requests (id, spec_num, org_id, name) VALUES ('new-1','П202608-01','org-other','other org, same number')`);
  const rows = db.exec(`SELECT id FROM requests WHERE spec_num='П202608-01'`);
  assert.equal(rows[0].values.length, 2, 'после миграции одинаковый номер у разных организаций должен допускаться');
});

test('повторный прогон runMigrations идемпотентен (не падает на уже смигрированной БД)', async () => {
  const db = await freshDb();
  runMigrations(db);
  runMigrations(db); // повторный прогон не должен бросать исключение
  const rows = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='requests'`);
  assert.equal(rows.length, 1, 'таблица requests должна существовать после повторной миграции');
});
