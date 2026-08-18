const { hashPassword, generateSalt } = require('../auth/crypto');
const { LEGACY_PASSWORD } = require('../config');

// Применяет схему и миграции к переданному sql.js Database-инстансу.
// Вызывается один раз при старте, до того как остальной код начнёт им пользоваться.
function runMigrations(db) {
  db.run(`PRAGMA journal_mode=WAL`);
  db.run(`PRAGMA foreign_keys=ON`);

  // NOTE: the `requests` table must exist before we try to ALTER it below —
  // on a brand-new database these ALTERs used to run before CREATE TABLE
  // requests (further down this function), so they silently failed and the
  // resulting fresh table was permanently missing these columns, breaking
  // every save with "table requests has no column named ...". Create the
  // core tables first, then run the column migrations against them.
  db.run(`CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY, spec_num TEXT NOT NULL,
    org_id TEXT, org_full TEXT, org_short TEXT, org_signatory TEXT,
    bitrix TEXT DEFAULT '', name TEXT NOT NULL, mol TEXT DEFAULT '',
    date TEXT DEFAULT '', address TEXT DEFAULT '', supplier TEXT DEFAULT '', invoice_num TEXT DEFAULT '',
    contract TEXT DEFAULT '', status TEXT DEFAULT 'new', comment TEXT DEFAULT '',
    is_realization INTEGER DEFAULT 0, delivery_cost REAL DEFAULT 0,
    markup REAL DEFAULT 5, total_purchase REAL DEFAULT 0, total REAL DEFAULT 0,
    positions TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(org_id, spec_num)
  )`);

  // Migrations — add new columns to existing DBs
  const migrations = [
    `ALTER TABLE requests ADD COLUMN invoice_num TEXT DEFAULT ''`,
    `ALTER TABLE requests ADD COLUMN signed_spec_pdf TEXT DEFAULT ''`,  // base64 подписанной спецификации
    `ALTER TABLE requests ADD COLUMN invoice_file TEXT DEFAULT ''`,     // имя файла приложенного счёта
    `ALTER TABLE requests ADD COLUMN invoice_file_original_name TEXT DEFAULT ''`, // оригинальное имя файла счёта (для раскладки в сетевую папку без переименования)
    `ALTER TABLE requests ADD COLUMN org_stamp TEXT DEFAULT '1'`,       // печать покупателя: '1' с печатью (М.П.), '0' без (Б.П.)
    `ALTER TABLE requests ADD COLUMN doc_type TEXT DEFAULT 'goods'`,    // тип документа: goods | install | support
    `ALTER TABLE requests ADD COLUMN counterparty TEXT DEFAULT ''`,    // контрагент/магазин закупки (для фильтров в реестре)
    `ALTER TABLE requests ADD COLUMN warranty_period TEXT DEFAULT ''`, // гарантийный срок — только для docType='support' (Акт гарантийного обслуживания)
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      request_id TEXT, action TEXT NOT NULL,
      field TEXT, old_value TEXT, new_value TEXT, meta TEXT
    )`,
  ];
  for (const m of migrations) {
    try { db.run(m); } catch(e) { /* column already exists */ }
  }

  // Миграция: spec_num раньше был уникален ГЛОБАЛЬНО по всей таблице —
  // с переходом на нумерацию по типу документа (П/Р/М/С без привязки к
  // организации) это стало давать ложные конфликты между РАЗНЫМИ
  // организациями (напр. «Лето» и «Ясно» в одном месяце оба получают
  // П202608-01 — второй сохранить уже нельзя). Правильная область
  // уникальности — (org_id, spec_num), а не просто spec_num. SQLite не
  // умеет менять UNIQUE-ограничение через ALTER TABLE, поэтому при
  // обнаружении старой схемы пересобираем таблицу.
  try {
    const oldSchema = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='requests'`);
    const sql = oldSchema[0]?.values?.[0]?.[0] || '';
    if (/spec_num\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(sql)) {
      db.run(`ALTER TABLE requests RENAME TO requests_old_unique_migration`);
      db.run(`CREATE TABLE requests (
        id TEXT PRIMARY KEY, spec_num TEXT NOT NULL,
        org_id TEXT, org_full TEXT, org_short TEXT, org_signatory TEXT,
        bitrix TEXT DEFAULT '', name TEXT NOT NULL, mol TEXT DEFAULT '',
        date TEXT DEFAULT '', address TEXT DEFAULT '', supplier TEXT DEFAULT '', invoice_num TEXT DEFAULT '',
        contract TEXT DEFAULT '', status TEXT DEFAULT 'new', comment TEXT DEFAULT '',
        is_realization INTEGER DEFAULT 0, delivery_cost REAL DEFAULT 0,
        markup REAL DEFAULT 5, total_purchase REAL DEFAULT 0, total REAL DEFAULT 0,
        positions TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        signed_spec_pdf TEXT DEFAULT '',
        invoice_file TEXT DEFAULT '',
        invoice_file_original_name TEXT DEFAULT '',
        org_stamp TEXT DEFAULT '1',
        doc_type TEXT DEFAULT 'goods',
        counterparty TEXT DEFAULT '',
        UNIQUE(org_id, spec_num)
      )`);
      db.run(`INSERT INTO requests (
        id, spec_num, org_id, org_full, org_short, org_signatory, bitrix, name, mol,
        date, address, supplier, invoice_num, contract, status, comment, is_realization,
        delivery_cost, markup, total_purchase, total, positions, created_at, updated_at,
        signed_spec_pdf, invoice_file, invoice_file_original_name, org_stamp, doc_type, counterparty
      ) SELECT
        id, spec_num, org_id, org_full, org_short, org_signatory, bitrix, name, mol,
        date, address, supplier, invoice_num, contract, status, comment, is_realization,
        delivery_cost, markup, total_purchase, total, positions, created_at, updated_at,
        signed_spec_pdf, invoice_file, invoice_file_original_name, org_stamp, doc_type, counterparty
      FROM requests_old_unique_migration`);
      db.run(`DROP TABLE requests_old_unique_migration`);
    }
  } catch(e) {
    console.error('[migration] spec_num unique-scope rebuild failed:', e.message);
  }

  // Migrate legacy status values: inwork→ordered, paid→delivered
  try {
    db.run(`UPDATE requests SET status='ordered'   WHERE status='inwork'`);
    db.run(`UPDATE requests SET status='delivered' WHERE status='paid'`);
  } catch(e) {}

  // Audit log table
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT    NOT NULL DEFAULT (datetime('now')),
    request_id TEXT,
    action    TEXT    NOT NULL,
    field     TEXT,
    old_value TEXT,
    new_value TEXT,
    meta      TEXT
  )`);

  // Settings table
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY, full TEXT NOT NULL, short TEXT NOT NULL,
    prefix TEXT NOT NULL, signatory TEXT DEFAULT '', contract TEXT DEFAULT '',
    address TEXT DEFAULT '', supplier TEXT DEFAULT '', folder TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  // Migration: add supplier column if it doesn't exist yet
  try { db.run(`ALTER TABLE orgs ADD COLUMN supplier TEXT DEFAULT ''`); } catch(e) {}
  // Migration: печать покупателя (М.П./Б.П.) — по умолчанию '1' (с печатью), как было раньше
  try { db.run(`ALTER TABLE orgs ADD COLUMN stamp TEXT DEFAULT '1'`); } catch(e) {}
  // Migration: отдельное имя папки для раскладки файлов (напр. «ЛД»), может
  // отличаться от короткого названия, которое показывается в интерфейсе
  try { db.run(`ALTER TABLE orgs ADD COLUMN folder TEXT DEFAULT ''`); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY, spec_num TEXT NOT NULL,
    org_id TEXT, org_full TEXT, org_short TEXT, org_signatory TEXT,
    bitrix TEXT DEFAULT '', name TEXT NOT NULL, mol TEXT DEFAULT '',
    date TEXT DEFAULT '', address TEXT DEFAULT '', supplier TEXT DEFAULT '', invoice_num TEXT DEFAULT '',
    contract TEXT DEFAULT '', status TEXT DEFAULT 'new', comment TEXT DEFAULT '',
    is_realization INTEGER DEFAULT 0, delivery_cost REAL DEFAULT 0,
    markup REAL DEFAULT 5, total_purchase REAL DEFAULT 0, total REAL DEFAULT 0,
    positions TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(org_id, spec_num)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT UNIQUE NOT NULL, used_at TEXT DEFAULT (datetime('now'))
  )`);

  // Indexes for commonly filtered/sorted fields
  db.run(`CREATE INDEX IF NOT EXISTS idx_requests_org_id    ON requests (org_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_requests_date      ON requests (date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_requests_status    ON requests (status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_requests_created   ON requests (created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_request_id   ON audit_log (request_id)`);

  db.run(`CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, positions TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    user_id    INTEGER
  )`);
  // Migration: add user_id to existing sessions table
  try { db.run(`ALTER TABLE sessions ADD COLUMN user_id INTEGER`); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE,
    password             TEXT NOT NULL,
    salt                 TEXT NOT NULL DEFAULT '',
    role                 TEXT NOT NULL DEFAULT 'operator',
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT DEFAULT (datetime('now'))
  )`);
  // Migrations for existing DBs
  try { db.run(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
  // Соль-на-пользователя (см. auth/crypto.js) — у строк, заведённых до этой
  // миграции, salt='' по умолчанию; findUserByCredentials() распознаёт это
  // как «старый формат» и доиграет соль при следующем успешном входе, не
  // требуя принудительного сброса пароля всем сразу.
  try { db.run(`ALTER TABLE users ADD COLUMN salt TEXT NOT NULL DEFAULT ''`); } catch(e) {}

  // Seed default admin on first run (no users in DB, no LEGACY_PASSWORD in env)
  const userCount = (() => {
    try { return db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] || 0; } catch(e) { return 0; }
  })();
  if (userCount === 0 && !LEGACY_PASSWORD) {
    const defaultSalt = generateSalt();
    const defaultHash = hashPassword('admin0000', defaultSalt);
    try {
      db.run('INSERT INTO users (username, password, salt, role, must_change_password) VALUES (?,?,?,?,?)',
        ['admin', defaultHash, defaultSalt, 'admin', 1]);
      console.log('[users] ✓ Default admin created — login: admin / password: admin0000');
      console.log('[users] ⚠ Change the password on first login!');
    } catch(e) { console.error('[users] seed error:', e.message); }
  }

  // Purge expired sessions left over from previous runs
  db.run(`DELETE FROM sessions WHERE expires_at < ?`, [Date.now()]);

  // Orgs are created by the user — no seed data
}

module.exports = { runMigrations };
