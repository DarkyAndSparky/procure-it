const fs = require('fs');
const initSqlJs = require('sql.js');
const { DB_FILE } = require('../config');
const { runMigrations } = require('./schema');

let SQL, db;

// Единственное место в приложении, которое держит живой инстанс sql.js.
// Всё остальное ходит через query()/run()/saveDb()/getDb() — никто больше
// не должен require()-ить sql.js напрямую.
function getDb() { return db; }

function saveDb() {
  const data = db.export();
  // Atomic write: write to a temp file first, then rename. A crash mid-write
  // to DB_FILE directly could leave a truncated/corrupt db file behind;
  // rename() on the same filesystem is atomic, so DB_FILE is always either
  // the old or the new complete version.
  const tmpFile = `${DB_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, Buffer.from(data));
  // На Windows rename() поверх DB_FILE может кратковременно упасть с EPERM/
  // EBUSY, если файл в этот момент открыт другим процессом — антивирусное
  // сканирование, индексатор, а особенно OneDrive Known Folder Move (когда
  // папка Desktop/Documents синхронизируется в облако — очень частая
  // конфигурация на корпоративных Windows) регулярно ненадолго блокируют
  // файл сразу после записи. Баг воспроизведён вживую: смена пароля падала
  // с "EPERM: operation not permitted, rename ... zakupki.db.tmp-N ->
  // zakupki.db" прямо в UI. На POSIX (Linux/macOS) rename() не требует,
  // чтобы целевой файл был не занят, так что там это в принципе не
  // воспроизводится — проблема чисто Windows-специфичная. Блокировка почти
  // всегда снимается сама за десятки-сотни миллисекунд, поэтому retry с
  // короткой синхронной паузой (Atomics.wait — единственный способ
  // синхронно подождать в Node.js без внешних зависимостей) решает
  // подавляющее большинство случаев, не переводя весь путь БД на async.
  const isWindowsLockError = e => e && (e.code === 'EPERM' || e.code === 'EBUSY');
  const MAX_ATTEMPTS = 8;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmpFile, DB_FILE);
      return;
    } catch (e) {
      if (!isWindowsLockError(e) || attempt === MAX_ATTEMPTS) {
        // Не удалось даже после всех попыток — подчищаем временный файл,
        // чтобы он не копился при каждом неудачном saveDb(), и пробрасываем
        // ошибку дальше. Вызывающий код (routes/*.js) должен считать, что
        // изменения НЕ сохранены на диск, даже если run() уже применился к
        // in-memory базе — см. комментарии в auth.js/change-password.
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        throw e;
      }
      const delayMs = Math.min(20 * attempt, 150);
      const sab = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(sab), 0, 0, delayMs);
    }
  }
}

async function initDb() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }
  runMigrations(db);
}

function query(sql, params = []) {
  try {
    const result = db.exec(sql, params);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
  } catch(e) { console.error('Query error:', sql, e.message); return []; }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
  } catch (e) {
    // SQL-ошибка (constraint violation и т.п.) — поведение как раньше:
    // молча возвращаем false, вызывающий код (requests.js — создание/
    // редактирование заявки) сам решает, что сказать пользователю
    // ("номер спецификации уже занят"). Эта ветка НЕ связана с записью
    // на диск, поэтому throw здесь не нужен и сломал бы то сообщение.
    console.error('Run error (SQL):', sql, e.message);
    return false;
  }
  // db.run() выше уже применился к in-memory БД. saveDb() (запись на диск)
  // может упасть отдельно — раньше это тоже тихо глоталось тем же catch,
  // что и SQL-ошибки, и функция всегда возвращала false без разбора причины.
  // Нашли вживую: 70 из 72 мест, вызывающих run() в проекте, НЕ проверяют
  // возвращаемое значение вообще — при таком глотании клиент получал
  // res.json({ok:true}) и не подозревал, что на диск ничего не записалось
  // (после перезапуска сервера/сбоя изменения бы просто исчезли). saveDb()
  // теперь бросает наружу вместо возврата false — непойманное исключение
  // в route попадает в глобальный error handler (server.js) и отдаёт
  // клиенту честную 500 вместо молчаливого ложного успеха. Для route'ов,
  // где нужен явный откат in-memory состояния при такой ошибке (например
  // src/routes/auth.js — смена пароля), там теперь свой try/catch вокруг
  // run() с откатом; для большинства обычных INSERT/UPDATE достаточно
  // самой по себе 500-ошибки — клиент не решит, что изменение прошло.
  saveDb();
  return true;
}

// Заявка из строки БД → камелкейс-объект для API. PDF-поля отдаются как
// заглушки ('__has_pdf__'/'__has_file__'), а не сырой blob или имя файла —
// это специально для обычных API-ответов, чтобы не палить путь клиенту.
// Для бэкапа (routes/backup.js) реальные имена файлов достаются отдельным
// запросом поверх этого маппинга — см. комментарий там.
function rowToRequest(row) {
  if (!row) return null;
  // Баг (найден при аудите перед слиянием dev→main): JSON.parse() без
  // try/catch — эта функция вызывается для КАЖДОЙ строки на GET /api/requests
  // (список реестра), так что один-единственный битый JSON в positions
  // (повреждённая БД, ручное редактирование файла, будущий баг записи)
  // ронял бы загрузку ВСЕГО списка заявок для всех пользователей, а не
  // только одну эту заявку. Отдельно — positions должен быть именно
  // массивом: если в БД случайно оказалась строка/объект/число, дальнейший
  // код (.map/.reduce по позициям) упал бы TypeError'ом в произвольном
  // месте фронтенда, а не с понятной ошибкой здесь.
  let positions = [];
  try {
    const parsed = JSON.parse(row.positions || '[]');
    positions = Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(parsed)) {
      console.warn(`[rowToRequest] positions заявки ${row.id} — не массив после JSON.parse, подставлен []`);
    }
  } catch(e) {
    console.warn(`[rowToRequest] Битый JSON в positions заявки ${row.id}: ${e.message} — подставлен []`);
  }
  return {
    id: row.id, specNum: row.spec_num, orgId: row.org_id,
    orgFull: row.org_full, orgShort: row.org_short, orgSignatory: row.org_signatory,
    orgStamp: row.org_stamp === undefined || row.org_stamp === null ? true : row.org_stamp === '1',
    signedSpecPdf: row.signed_spec_pdf ? '__has_pdf__' : '',
    invoiceFile: row.invoice_file ? '__has_file__' : '',
    docType: row.doc_type || 'goods',
    bitrix: row.bitrix, name: row.name, mol: row.mol, date: row.date,
    address: row.address, supplier: row.supplier, invoiceNum: row.invoice_num, contract: row.contract,
    counterparty: row.counterparty || '',
    warrantyPeriod: row.warranty_period || '',
    status: row.status, comment: row.comment,
    isRealization: !!row.is_realization,
    deliveryCost: row.delivery_cost, markup: row.markup,
    totalPurchase: row.total_purchase, total: row.total,
    positions,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

module.exports = { initDb, getDb, query, run, saveDb, rowToRequest };
