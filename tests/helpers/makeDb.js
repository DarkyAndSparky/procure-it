'use strict';
/**
 * makeDb() — создаёт изолированный экземпляр РЕАЛЬНОГО server/database.js
 * (настоящие repo-файлы, а не повторная реализация их логики) поверх
 * временной lowdb-директории. Каждый вызов = чистая БД с системными
 * заглушками, как раньше.
 *
 * Фаза 7c (находка): раньше этот файл заново реализовывал ~500 строк
 * бизнес-логики database.js независимо (своя копия createOrg/liquidateOrg/
 * authUser/и т.д.). Из-за этого весь набор из 237 тестов проверял копию
 * логики, а не оригинал — server/repositories/*.repo.js и server/database.js
 * не вызывались тестами вообще. Теперь makeDb() требует настоящий
 * server/database.js через jest.requireActual (чтобы не попасть в петлю
 * с jest.mock('../server/database', ...) в файлах тестов, которые ссылаются
 * на этот же путь), указывая ему на свежую временную директорию через
 * IT_ASSETS_DATA_DIR.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'it-assets-test-'));
  const prevDataDir = process.env.IT_ASSETS_DATA_DIR;
  process.env.IT_ASSETS_DATA_DIR = dir;

  // Сбрасываем кэш require, чтобы server/db/store.js (и все repo-файлы,
  // держащие ссылку на его db/cfg-синглтон) переинициализировались на
  // новый DATA_DIR, а не переиспользовали инстанс из предыдущего вызова.
  jest.resetModules();
  const db = jest.requireActual('../../server/database');
  // sqlite/META_KEYS фиксируем СЕЙЧАС, в том же require-окне, что и db —
  // не лениво внутри _addAsset ниже, иначе повторный makeDb() в этом же
  // файле тестов (jest.resetModules() снова) мог бы на момент вызова
  // _addAsset() отдать другой (более новый) инстанс sqlite, чем тот,
  // на котором реально работает этот db.
  const { sqlite, META_KEYS } = jest.requireActual('../../server/db/sqlite');

  // Возвращаем IT_ASSETS_DATA_DIR как было: некоторые тесты (например
  // backup.test.js) выставляют свою переменную окружения ДО makeDb() для
  // других модулей (index.js читает её напрямую при require, в обход
  // database.js) — makeDb() не должен переопределять её для них.
  if (prevDataDir === undefined) delete process.env.IT_ASSETS_DATA_DIR;
  else process.env.IT_ASSETS_DATA_DIR = prevDataDir;

  // Тестовый администратор с известным паролем для supertest-логина —
  // vместо системного sys-user-admin/admn0000 по умолчанию.
  // Фаза 7c-5: users переехали на SQLite — обновляем через реальный
  // db.updateUser() (сам хеширует pin через bcrypt), прямая правка cfg
  // (lowdb) больше не действует. id остаётся 'sys-user-admin' — тесты
  // читают id из ответа логина динамически, ни один не завязан на
  // конкретное значение id.
  db.updateUser('sys-user-admin', { name: 'Test Admin', pin: 'test123' });

  // Тестовые дефолты справочников (как в прежнем fake) — реальные дефолты
  // из db/store.js шире (полный TYPE_CODES_MAP, другое company_name),
  // но ни один тест не завязан на точный состав, только на структуру.
  // Фаза 7c-4: settings/categories переехали на SQLite — пишем через
  // реальный db.config.*, прямая правка cfg (lowdb) больше не действует
  // на getSettings()/getCategories().
  db.setSetting('company_name', 'Test Company');
  db.setCategories('os',    ['Оборудование пользователей', 'Оргтехника']);
  db.setCategories('small', ['Периферия']);
  db.setCategories('infra', ['Сетевое оборудование']);

  // Хелпер: добавить ассет напрямую, в обход createAsset() (нужен тестам,
  // которым важен конкретный набор полей без валидации/побочных эффектов
  // создания). Фаза 7c-8b: assets переехали в SQLite — прямая вставка в
  // SQL, а не lowdb push (assets.repo.js больше не читает lowdb вообще).
  db._addAsset = function(fields) {
    const now = new Date().toISOString();
    const { v7: uuidv7 } = require('uuid');
    const asset = {
      id: uuidv7(), tab: 'os', filial: '', location: '', responsible: '',
      type: '', model: '', serial: '', status: 'используется',
      note: '', inv: '', meta: {}, org_id: 'sys-org-unk',
      filial_id: 'sys-filial-unk', location_id: 'sys-location-unk',
      created_at: now, updated_at: now,
      ...fields,
    };
    const cols = ['id','tab','category','filial','address','location','responsible',
      'type','model','serial','status','org','note','inv','inv_prev',
      'org_id','filial_id','location_id','responsible_id','created_at','updated_at',
      ...META_KEYS.map(k => 'meta_' + k)];
    const values = cols.map(col => {
      if (col.startsWith('meta_')) return (asset.meta && asset.meta[col.slice(5)]) ?? null;
      return asset[col] !== undefined ? asset[col] : (col === 'category' || col === 'address' || col === 'org' ? '' : null);
    });
    sqlite.prepare(`INSERT INTO assets (${cols.join(', ')}) VALUES (${cols.map(()=>'?').join(', ')})`).run(...values);
    return asset;
  };

  // Тестовые хелперы прямого чтения — assets/history в SQLite (Фаза
  // 7c-8b), тестам, проверяющим состояние напрямую (не через API),
  // больше некуда идти кроме SQL. Возвращают row-как-объект (плоские
  // meta_*-колонки, не вложенный meta{} — тестам, использующим эти
  // хелперы, нужны только плоские поля).
  db._getAssets  = () => sqlite.prepare('SELECT * FROM assets').all();
  db._getAsset   = (id) => sqlite.prepare('SELECT * FROM assets WHERE id = ?').get(id) || null;
  db._getHistory = () => sqlite.prepare('SELECT * FROM history ORDER BY rowid').all();

  return db;
}

module.exports = makeDb;
