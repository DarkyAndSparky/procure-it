/**
 * server/db/sqlite.js
 *
 * Фаза 7c рефакторинга: SQLite-хранилище через встроенный node:sqlite
 * (Node 22.5+, стабилизирован в Node 25.7/26 — см. ROADMAP). Выбран вместо
 * better-sqlite3 намеренно: ноль нативных аддонов, значит ни пересборки
 * под платформу, ни проблем в Docker/разных ОС коллег (см. обсуждение
 * альтернатив в истории Фазы 7c).
 *
 * Миграция repo-файлов на SQL идёт по одному файлу за раз (как и весь
 * остальной рефакторинг) — таблицы создаются здесь по мере перевода
 * конкретных сущностей, не все сразу. Кросс-ссылки на ещё не переехавшие
 * таблицы (например, filials.org_id → organizations, пока в lowdb)
 * намеренно без FK-constraint — lowdb тоже не проверял ссылочную
 * целостность на уровне хранилища, так что строгость не меняется ни
 * в одну, ни в другую сторону.
 *
 * Файл БД лежит рядом с db.json/config.json — в той же IT_ASSETS_DATA_DIR,
 * так что тестовая изоляция (через makeDb.js) работает автоматически,
 * без отдельной настройки.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path   = require('path');
const fs     = require('fs');
const logger = require('../logger');

const DATA_DIR = process.env.IT_ASSETS_DATA_DIR
  ? path.resolve(process.env.IT_ASSETS_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const SQLITE_PATH = path.join(DATA_DIR, 'it-assets.sqlite');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new DatabaseSync(SQLITE_PATH);

// WAL — конкурентное чтение во время записи (актуально при нескольких
// пользователях в LAN одновременно), надёжнее дефолтного rollback-журнала
// при неожиданном завершении процесса.
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

// ─── Схемы таблиц ───────────────────────────────────────────────────────

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    login      TEXT NOT NULL DEFAULT '',
    password   TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS filials (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    address    TEXT NOT NULL DEFAULT '',
    org_id     TEXT,
    status     TEXT NOT NULL DEFAULT 'active',
    system     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    closed_at  TEXT
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    filial_id  TEXT,
    type       TEXT NOT NULL DEFAULT 'office',
    status     TEXT NOT NULL DEFAULT 'active',
    system     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    closed_at  TEXT
  );
`);

// ─── Схема: settings / categories / type_codes (Фаза 7c-4) ────────────────
// settings и categories — маленькие конфиг-блобы с произвольным доступом
// по ключу (не полноценные реляционные данные), поэтому key-value таблицы
// с JSON-значением, а не попытка развернуть их в жёсткие колонки.
// type_codes — по форме настоящая таблица (code/name/tab на запись).

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    tab   TEXT PRIMARY KEY,
    items TEXT NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS type_codes (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tab  TEXT NOT NULL DEFAULT 'os'
  );
`);

// ─── Схема: users (Фаза 7c-5) ───────────────────────────────────────────
// login уникальность проверяется в JS (регистронезависимо), как и в
// оригинале — не DB-constraint, чтобы не менять точную семантику сравнения
// (trim + toLowerCase), которую сложно корректно выразить как UNIQUE INDEX
// без отдельной нормализованной колонки.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    login      TEXT NOT NULL DEFAULT '',
    role       TEXT NOT NULL DEFAULT 'operator',
    pin        TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
`);

// SEC-4: разрешение оператору видеть логины/пароли в разделе «Учётные
// записи» (по умолчанию выключено — включает админ точечно, пользователю).
// Старые базы созданы до этого поля — CREATE TABLE IF NOT EXISTS их не
// тронет, поэтому колонку добавляем отдельно, только если её ещё нет.
try {
  const userCols = sqlite.prepare(`PRAGMA table_info(users)`).all();
  if (!userCols.some(c => c.name === 'can_view_accounts')) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN can_view_accounts INTEGER NOT NULL DEFAULT 0`);
  }
} catch (e) { logger.error('DB', 'add can_view_accounts column failed', e.message); }

// ─── Схема: employees (Фаза 7c-6) ─────────────────────────────────────────
// filial — свободный текст (legacy-поле, не FK на filials.id — так было и
// в оригинале, не только сейчас при переезде).

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    dept           TEXT NOT NULL DEFAULT '',
    filial         TEXT NOT NULL DEFAULT '',
    phone          TEXT NOT NULL DEFAULT '',
    email          TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL,
    deactivated_at TEXT
  );
`);

// ─── Схема: organizations + org_inv_rules (Фаза 7c-7) ─────────────────────
// inv_rules — было вложенным массивом внутри org в lowdb, здесь —
// нормальная дочерняя таблица 1:N с явным org_id + FK ON DELETE CASCADE
// (обе таблицы теперь в одном движке — можно и нужно настоящий constraint,
// в отличие от filials.org_id/locations.filial_id, которые всё ещё
// указывают НА lowdb-данные). rule_order сохраняет исходный порядок
// элементов массива (важно для фронтенда — выпадающие списки и т.п.).

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    short_code    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    system        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    renamed_from  TEXT,
    renamed_at    TEXT,
    liquidated_at TEXT
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS org_inv_rules (
    org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    type_code  TEXT NOT NULL,
    type_name  TEXT NOT NULL,
    counter    INTEGER NOT NULL DEFAULT 0,
    format     TEXT NOT NULL DEFAULT '{org}-{type}-{N:05}',
    active     INTEGER NOT NULL DEFAULT 1,
    rule_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, type_code)
  );
`);

// ─── Одноразовая миграция из lowdb config.json (идемпотентна) ─────────────
//
// Общий хелпер: переносит коллекцию cfg[cfgKey] в таблицу table один раз —
// только если таблица ещё пуста (не трогаем данные при каждом старте).
// cfg[cfgKey] после переноса НЕ удаляется автоматически (отдельный шаг
// очистки — после того как весь repo-слой сущности переведён и вручную
// проверен на реальных данных, см. ROADMAP Фаза 7c).
function migrateFromLowdb(table, cfgKey, columns, rowToValues) {
  const row = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  if (row.c > 0) return; // уже мигрировано или создано с нуля в SQLite

  let cfg;
  try {
    ({ cfg } = require('./store'));
  } catch (e) {
    return; // store.js недоступен (например, юнит-тест изолированного sqlite.js)
  }

  const oldRows = cfg.get(cfgKey).value() || [];
  if (!oldRows.length) return;

  const placeholders = columns.map(() => '?').join(', ');
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
  );
  for (const r of oldRows) insert.run(...rowToValues(r));
  logger.info('SQLite', `мигрировано ${oldRows.length} ${table} из config.json`);
}

migrateFromLowdb(
  'accounts', 'accounts',
  ['id', 'name', 'login', 'password', 'note', 'category', 'created_at'],
  a => [a.id, a.name || '', a.login || '', a.password || '', a.note || '', a.category || '', a.created_at || new Date().toISOString()]
);

migrateFromLowdb(
  'filials', 'filials',
  ['id', 'name', 'address', 'org_id', 'status', 'system', 'created_at', 'closed_at'],
  f => [f.id, f.name || '', f.address || '', f.org_id || null, f.status || 'active', f.system ? 1 : 0, f.created_at || new Date().toISOString(), f.closed_at || null]
);

migrateFromLowdb(
  'locations', 'locations',
  ['id', 'name', 'filial_id', 'type', 'status', 'system', 'created_at', 'closed_at'],
  l => [l.id, l.name || '', l.filial_id || null, l.type || 'office', l.status || 'active', l.system ? 1 : 0, l.created_at || new Date().toISOString(), l.closed_at || null]
);

// ─── Миграция settings / categories / type_codes ──────────────────────────
// Другая форма (не построчная коллекция), поэтому отдельная логика, не
// через migrateFromLowdb().

function migrateSettingsFromLowdb() {
  const row = sqlite.prepare('SELECT COUNT(*) AS c FROM settings').get();
  if (row.c > 0) return;
  let cfg;
  try { ({ cfg } = require('./store')); } catch (e) { return; }
  const oldSettings = cfg.get('settings').value() || {};
  const keys = Object.keys(oldSettings);
  if (!keys.length) return;
  const insert = sqlite.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const k of keys) insert.run(k, JSON.stringify(oldSettings[k]));
  logger.info('SQLite', `мигрировано ${keys.length} settings из config.json`);
}

function migrateCategoriesFromLowdb() {
  const row = sqlite.prepare('SELECT COUNT(*) AS c FROM categories').get();
  if (row.c > 0) return;
  let cfg;
  try { ({ cfg } = require('./store')); } catch (e) { return; }
  const oldCategories = cfg.get('categories').value() || {};
  const tabs = Object.keys(oldCategories);
  if (!tabs.length) return;
  const insert = sqlite.prepare('INSERT OR IGNORE INTO categories (tab, items) VALUES (?, ?)');
  for (const t of tabs) insert.run(t, JSON.stringify(oldCategories[t] || []));
  logger.info('SQLite', `мигрировано ${tabs.length} categories из config.json`);
}

function migrateTypeCodesFromLowdb() {
  const row = sqlite.prepare('SELECT COUNT(*) AS c FROM type_codes').get();
  if (row.c > 0) return;
  let cfg;
  try { ({ cfg } = require('./store')); } catch (e) { return; }
  const oldCodes = cfg.get('type_codes').value() || [];
  if (!oldCodes.length) return;
  const insert = sqlite.prepare('INSERT OR IGNORE INTO type_codes (code, name, tab) VALUES (?, ?, ?)');
  for (const c of oldCodes) insert.run(c.code, c.name || '', c.tab || 'os');
  logger.info('SQLite', `мигрировано ${oldCodes.length} type_codes из config.json`);
}

migrateSettingsFromLowdb();
migrateCategoriesFromLowdb();
migrateTypeCodesFromLowdb();

migrateFromLowdb(
  'users', 'users',
  ['id', 'name', 'login', 'role', 'pin', 'email', 'active', 'created_at'],
  u => [u.id, u.name || '', u.login || '', u.role || 'operator', u.pin || '', u.email || '', (u.active !== false) ? 1 : 0, u.created_at || new Date().toISOString()]
);

migrateFromLowdb(
  'employees', 'employees',
  ['id', 'name', 'dept', 'filial', 'phone', 'email', 'note', 'active', 'created_at', 'deactivated_at'],
  e => [e.id, e.name || '', e.dept || '', e.filial || '', e.phone || '', e.email || '', e.note || '', (e.active !== false) ? 1 : 0, e.created_at || new Date().toISOString(), e.deactivated_at || null]
);

// ─── Миграция organizations + org_inv_rules ────────────────────────────────
// Двухуровневая структура (родитель + дочерние правила на каждую запись) —
// не подходит под общий migrateFromLowdb(), отдельная функция.

function migrateOrgsFromLowdb() {
  const row = sqlite.prepare('SELECT COUNT(*) AS c FROM organizations').get();
  if (row.c > 0) return;

  let cfg;
  try { ({ cfg } = require('./store')); } catch (e) { return; }

  const oldOrgs = cfg.get('organizations').value() || [];
  if (!oldOrgs.length) return;

  const insertOrg  = sqlite.prepare(
    'INSERT OR IGNORE INTO organizations (id, name, short_code, status, system, created_at, renamed_from, renamed_at, liquidated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertRule = sqlite.prepare(
    'INSERT OR IGNORE INTO org_inv_rules (org_id, type_code, type_name, counter, format, active, rule_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  sqlite.exec('BEGIN');
  try {
    for (const o of oldOrgs) {
      insertOrg.run(
        o.id, o.name || '', o.short_code || '', o.status || 'active', o.system ? 1 : 0,
        o.created_at || new Date().toISOString(), o.renamed_from || null, o.renamed_at || null, o.liquidated_at || null
      );
      (o.inv_rules || []).forEach((r, idx) => {
        insertRule.run(o.id, r.type_code, r.type_name || '', r.counter || 0, r.format || '{org}-{type}-{N:05}', r.active !== false ? 1 : 0, idx);
      });
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  logger.info('SQLite', `мигрировано ${oldOrgs.length} organizations из config.json`);
}

migrateOrgsFromLowdb();

// ─── Схема: assets + history (Фаза 7c-8a) ──────────────────────────────────
// Это самая крупная и рискованная подфаза (см. ROADMAP): db.get('assets')/
// db.get('history') используются в 11 файлах, 58 точек вызова. Поэтому
// схема+миграция сделаны ОТДЕЛЬНЫМ шагом до правки repo-слоя — на этом шаге
// таблицы создаются и заполняются, но ничто в приложении их ещё не читает
// (assets.repo.js и все зависимые файлы по-прежнему на db.get() из lowdb).
// Мета-поля (ip/mac/subnet и т.д.) развёрнуты в отдельные колонки, а не
// JSON-блобом — список взят из единственного канонического места:
// public/js/meta-fields.js (META_LABELS). Расширяемо: ALTER TABLE ADD COLUMN
// при необходимости добавить новое поле, без пересоздания таблицы.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS assets (
    id             TEXT PRIMARY KEY,
    tab            TEXT NOT NULL DEFAULT 'os',
    category       TEXT NOT NULL DEFAULT '',
    filial         TEXT NOT NULL DEFAULT '',
    address        TEXT NOT NULL DEFAULT '',
    location       TEXT NOT NULL DEFAULT '',
    responsible    TEXT NOT NULL DEFAULT '',
    type           TEXT NOT NULL DEFAULT '',
    model          TEXT NOT NULL DEFAULT '',
    serial         TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'используется',
    org            TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    inv            TEXT NOT NULL DEFAULT '',
    inv_prev       TEXT,
    org_id         TEXT,
    filial_id      TEXT,
    location_id    TEXT,
    responsible_id TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    meta_ip        TEXT,
    meta_mac       TEXT,
    meta_subnet    TEXT,
    meta_winbox    TEXT,
    meta_login     TEXT,
    meta_password  TEXT,
    meta_cabinet   TEXT,
    meta_controller TEXT,
    meta_inv       TEXT,
    meta_network   TEXT,
    meta_hostname  TEXT,
    meta_cartridge TEXT,
    meta_firmware  TEXT,
    meta_note2     TEXT
  );
`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_assets_org_id ON assets(org_id);`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id           TEXT PRIMARY KEY,
    asset_id     TEXT,
    action_type  TEXT NOT NULL DEFAULT 'move',
    date         TEXT NOT NULL,
    from_who     TEXT NOT NULL DEFAULT '',
    to_who       TEXT NOT NULL DEFAULT '',
    filial       TEXT NOT NULL DEFAULT '',
    location     TEXT NOT NULL DEFAULT '',
    equipment    TEXT NOT NULL DEFAULT '',
    model        TEXT NOT NULL DEFAULT '',
    type         TEXT NOT NULL DEFAULT '',
    serial       TEXT NOT NULL DEFAULT '',
    reason       TEXT NOT NULL DEFAULT '',
    changed_by   TEXT NOT NULL DEFAULT '',
    org_snapshot TEXT
  );
`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_history_asset_id ON history(asset_id);`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_history_date ON history(date);`);

const META_KEYS = ['ip','mac','subnet','winbox','login','password','cabinet',
  'controller','inv','network','hostname','cartridge','firmware','note2'];

function migrateAssetsFromLowdb() {
  const row = sqlite.prepare('SELECT COUNT(*) AS c FROM assets').get();
  if (row.c > 0) return;

  let db;
  try { ({ db } = require('./store')); } catch (e) { return; }

  const oldAssets = db.get('assets').value() || [];
  if (!oldAssets.length) return;

  const cols = ['id','tab','category','filial','address','location','responsible',
    'type','model','serial','status','org','note','inv','inv_prev',
    'org_id','filial_id','location_id','responsible_id','created_at','updated_at',
    ...META_KEYS.map(k => 'meta_' + k)];
  const placeholders = cols.map(() => '?').join(', ');
  const insert = sqlite.prepare(`INSERT OR IGNORE INTO assets (${cols.join(', ')}) VALUES (${placeholders})`);

  sqlite.exec('BEGIN');
  try {
    for (const a of oldAssets) {
      const meta = a.meta || {};
      insert.run(
        a.id, a.tab || 'os', a.category || '', a.filial || '', a.address || '',
        a.location || '', a.responsible || '', a.type || '', a.model || '',
        a.serial || '', a.status || 'используется', a.org || '', a.note || '',
        a.inv || '', a.inv_prev || null,
        a.org_id || null, a.filial_id || null, a.location_id || null, a.responsible_id || null,
        a.created_at || new Date().toISOString(), a.updated_at || new Date().toISOString(),
        ...META_KEYS.map(k => meta[k] || null)
      );
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  logger.info('SQLite', `мигрировано ${oldAssets.length} assets из db.json`);
}

// BUG-1 (repair): раньше миграция v6 (server/migrate.js) стирала поле
// category из db.json ДО того, как эта функция успевала его прочитать —
// см. подробный комментарий в migrate.js. Для установок, которые уже
// прошли эту миграцию раньше (schema_version уже 7, migrateAssetsFromLowdb
// выше не перезапустится — она разовая), category в SQLite могла остаться
// пустой навсегда. Этот проход чинит уже смигрированные данные: досчитывает
// category только там, где она пустая, а type известен — ничего не трогает
// у ассетов, где category уже заполнена (в т.ч. если её поставили вручную).
// Безопасно гонять на каждом старте — идемпотентно, при уже исправленных
// данных просто ничего не находит и почти не тратит времени.
const TYPE_CAT_MAP = {
  'коммутатор':'Сетевое оборудование','маршрутизатор':'Сетевое оборудование',
  'точка доступа':'Wi-Fi','радиомост':'Сетевое оборудование',
  'poe инжектор':'Сетевое оборудование','poe hub':'Сетевое оборудование',
  'видеорегистратор':'Видеонаблюдение','камера':'Видеонаблюдение',
  'вызывная панель':'Видеонаблюдение','видеодомофон':'Видеонаблюдение',
  'ибп':'ИБП','сервер':'Серверы',
  'мфу':'Оргтехника','принтер':'Оргтехника',
  'ноутбук':'Оборудование пользователей','системный блок':'Оборудование пользователей',
  'монитор':'Оборудование пользователей','телевизор':'Оборудование пользователей',
  'мини пк':'Мини ПК',
  'гарнитура':'Гарнитуры','наушники':'Гарнитуры','спикерфон':'Гарнитуры',
  'колонки':'Колонки','яндекс.станция':'Колонки',
};
function repairMissingCategories() {
  const rows = sqlite.prepare(
    `SELECT id, tab, type FROM assets WHERE (category IS NULL OR category = '') AND type != ''`
  ).all();
  if (!rows.length) return;

  const catsByTab = {};
  for (const row of sqlite.prepare('SELECT tab, items FROM categories').all()) {
    try { catsByTab[row.tab] = JSON.parse(row.items) || []; } catch(e) { catsByTab[row.tab] = []; }
  }

  const update = sqlite.prepare('UPDATE assets SET category = ? WHERE id = ?');
  let fixed = 0;
  sqlite.exec('BEGIN');
  try {
    for (const a of rows) {
      const key = (a.type || '').trim().toLowerCase();
      const mapped = TYPE_CAT_MAP[key];
      const tabCats = catsByTab[a.tab] || [];
      const category = (mapped && tabCats.includes(mapped)) ? mapped : (tabCats[0] || '');
      if (category) { update.run(category, a.id); fixed++; }
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  if (fixed > 0) logger.info('SQLite', `BUG-1 repair: восстановлена category для ${fixed} ассетов`);
}

function migrateHistoryFromLowdb() {
  const row = sqlite.prepare('SELECT COUNT(*) AS c FROM history').get();
  if (row.c > 0) return;

  let db;
  try { ({ db } = require('./store')); } catch (e) { return; }

  const oldHistory = db.get('history').value() || [];
  if (!oldHistory.length) return;

  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO history (id, asset_id, action_type, date, from_who, to_who, filial, location, equipment, model, type, serial, reason, changed_by, org_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  sqlite.exec('BEGIN');
  try {
    for (const h of oldHistory) {
      insert.run(
        h.id, h.asset_id || null, h.action_type || 'move', h.date || new Date().toISOString(),
        h.from_who || '', h.to_who || '', h.filial || '', h.location || '',
        h.equipment || '', h.model || '', h.type || '', h.serial || '',
        h.reason || '', h.changed_by || '', h.org_snapshot || null
      );
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  logger.info('SQLite', `мигрировано ${oldHistory.length} history из db.json`);
}

migrateAssetsFromLowdb();
repairMissingCategories();
migrateHistoryFromLowdb();

module.exports = { sqlite, SQLITE_PATH, META_KEYS, repairMissingCategories };
