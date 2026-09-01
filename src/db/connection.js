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
  fs.writeFileSync(DB_FILE, Buffer.from(data));
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
  try { db.run(sql, params); saveDb(); return true; }
  catch(e) { console.error('Run error:', sql, e.message); return false; }
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
