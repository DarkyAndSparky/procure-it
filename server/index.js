const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { v7: uuidv7 } = require('uuid');
const db       = require('./database');
const logger   = require('./logger');
const { sqlite } = require('./db/sqlite');

// Версия — единый источник правды теперь файл VERSION в корне репозитория
// (не package.json — plain-text файл проще редактировать вручную и не
// требует валидного JSON вокруг). package.json.version синхронизируется
// ОТ него через scripts/sync-version.js, не наоборот. Идея подсмотрена в
// соседнем проекте atlas-server: там ровно та же схема (VERSION в корне,
// server.js читает его напрямую, package.json — производная).
// Фолбэк на pkg.version — на случай если VERSION вдруг отсутствует
// (старый checkout без него), чтобы сервер не падал, а не для повседневного
// использования.
const pkg = (() => { try { return require('../package.json'); } catch(e) { return {}; } })();
const APP_VERSION = (() => {
  try { return require('fs').readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(); }
  catch(e) { return pkg.version || 'unknown'; }
})();

// Человекочитаемая версия: beta-1-26w27-01 → β1 · 26w27·01
const APP_VERSION_DISPLAY = APP_VERSION
  .replace(/^alpha-(\d+)-/, 'α$1 · ')
  .replace(/^beta-(\d+)-/,  'β$1 · ')
  .replace(/-/g, '·');
// Live getters — db.ORG_CODES / db.TYPE_CODES are defineProperty getters on db object
// Do NOT cache at startup: org names can change at runtime

const app  = express();
// Не раскрываем факт использования Express (мелкое, но бесплатное закрытие
// разведочной информации для потенциального атакующего).
app.disable('x-powered-by');

// Базовые security-заголовки + CSP.
// CSP теперь можно включить: Фаза 6 рефакторинга перевела ВСЕ inline
// onclick/onchange/oninput/... на addEventListener через делегирование
// (public/js/event-delegation.js, data-action="..."). Инлайн-скриптов и
// обработчиков в разметке больше не осталось — script-src 'self' без
// unsafe-inline не должен ничего сломать.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " + // много inline style="..." в шаблонах — отдельная задача, не блокер
    "img-src 'self' data:; " +         // data: — логотип компании хранится и как base64 (см. settings-general.js)
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "frame-ancestors 'none'"
  );
  next();
});

// Примечание: фактические HTTP/HTTPS порты объявлены ниже, в startServer()
// (HTTP_PORT / HTTPS_PORT), и настраиваются через process.env — см. там.

// CORS: фронтенд отдаётся тем же сервером (express.static), поэтому обычному
// использованию (открыть https://ip:3443 в браузере) кросс-origin вообще не
// нужен — такие запросы браузер не помечает Origin. Список ниже нужен только
// если API дергают с другого домена (отдельный фронтенд, реверс-прокси и т.п.).
// По умолчанию список пуст → кросс-origin запросы из браузера блокируются.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // curl, серверные вызовы, тот же origin
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, '../public')));

// ─── AUTH ─────────────────────────────────────────────────────────────────────
// requireAuth/requireAdmin/changedBy вынесены в server/middleware/auth.js (Фаза 1/2 рефакторинга)
const { requireAuth, requireAdmin, changedBy } = require('./middleware/auth');

// ─── SETTINGS (Фаза 3 рефакторинга) ──────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/settings', require('./routes/settings.routes'));

// ─── AUTH: ПОЛЬЗОВАТЕЛИ СИСТЕМЫ (Фаза 3 рефакторинга) ────────────────────────
// rateLimitLogin вынесен в server/middleware/rateLimit.js, роуты — в users.routes.js
app.use('/api/users', require('./routes/users.routes'));

// ─── CATEGORIES (Фаза 3 рефакторинга) ────────────────────────────────────────
app.use('/api/categories', require('./routes/categories.routes'));

// ─── ASSETS (Фаза 4 рефакторинга) ────────────────────────────────────────────
app.use('/api/assets', require('./routes/assets.routes'));
// ─── INVENTORY NUMBERS (Фаза 4b рефакторинга) ────────────────────────────────
app.use('/api/inv', require('./routes/inv.routes'));

// ─── HISTORY (Фаза 4 рефакторинга) ───────────────────────────────────────────
app.use('/api/history', require('./routes/history.routes'));

// ─── STATS (Фаза 4c рефакторинга) ────────────────────────────────────────────
app.use('/api/stats', require('./routes/stats.routes'));

// ─── ACCOUNTS ─────────────────────────────────────────────────────────────────
// ─── УЧЁТНЫЕ ЗАПИСИ (Фаза 3 рефакторинга) ────────────────────────────────────
app.use('/api/accounts', require('./routes/accounts.routes'));

// ─── CSV EXPORT/IMPORT + HISTORY IMPORT (Фаза 4d рефакторинга) ───────────────
app.use('/api', require('./routes/csv.routes'));

// ─── DB DIAGNOSTICS ──────────────────────────────────────────────────────────
app.get('/api/diag', requireAdmin, (req, res) => {
  const fs2 = require('fs');
  const dbPath = require('./db/store').DB_PATH;
  let writable = false, fileSize = 0, lastWrite = null;
  try { fs2.accessSync(dbPath, fs2.constants.W_OK); writable = true; } catch(e) {}
  try { const s = fs2.statSync(dbPath); fileSize = s.size; lastWrite = s.mtime; } catch(e) {}
  let writeOk = false;
  try { db.set('_meta.diag_ping', Date.now()).write(); writeOk = true; } catch(e) {}
  const schemaVer = db.cfg.get('_meta.schema_version').value() || '?';

  // Информация о последнем бэкапе
  let lastBackup = null;
  let backupCount = 0;
  try {
    const backups = listBackups();
    backupCount = backups.length;
    if (backups.length > 0) {
      lastBackup = { file: backups[0].name, mtime: backups[0].mtime, size: backups[0].size, full: backups[0].full };
    }
  } catch(e) {}

  res.json({
    dbPath, writable, writeOk, fileSize, lastWrite,
    schema_version: schemaVer,
    assets: sqlite.prepare('SELECT COUNT(*) c FROM assets').get().c,
    history: sqlite.prepare('SELECT COUNT(*) c FROM history').get().c,
    backup: { last: lastBackup, count: backupCount, dir: BACKUP_DIR },
  });
});

// Принудительный запуск миграций (для ручного пересчёта категорий и т.д.)
app.post('/api/migrate', requireAdmin, (req, res) => {
  try {
    const migrate = require('./migrate');
    // Сбрасываем версию чтобы миграция перезапустила все шаги
    const targetVersion = parseInt(req.body.from_version || 0);
    db.cfg.set('_meta.schema_version', targetVersion).write();
    migrate(db, db.cfg);
    const newVer = db.cfg.get('_meta.schema_version').value();
    res.json({ ok: true, schema_version: newVer });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── СПРАВОЧНИК: СОТРУДНИКИ ───────────────────────────────────────────────────
// ─── СОТРУДНИКИ: CRUD + reassign-assets (Фазы 3-4 рефакторинга) ─────────────
app.use('/api/employees', require('./routes/employees.routes'));

// ─── СПРАВОЧНИК: ОРГАНИЗАЦИИ ──────────────────────────────────────────────────

// ─── СПРАВОЧНИКИ: ОРГАНИЗАЦИИ / ФИЛИАЛЫ / ЛОКАЦИИ ────────────────────────────
// Роуты вынесены в server/routes/{orgs,filials,locations}.routes.js (Фаза 1 рефакторинга)
app.use('/api/orgs', require('./routes/orgs.routes'));
app.use('/api/filials', require('./routes/filials.routes'));
app.use('/api/locations', require('./routes/locations.routes'));

// ─── КОНФИГ: ЭКСПОРТ / ИМПОРТ ────────────────────────────────────────────────

// ─── CONFIG EXPORT/IMPORT (Фаза 4b рефакторинга) ─────────────────────────────
app.use('/api/config', require('./routes/config.routes'));

// ─── TYPE CODES (Фаза 4b рефакторинга) ───────────────────────────────────────
app.use('/api', require('./routes/types.routes'));




// ─── BACKUP ───────────────────────────────────────────────────────────────────
const fs = require('fs');

const DATA_DIR   = process.env.IT_ASSETS_DATA_DIR
  ? path.resolve(process.env.IT_ASSETS_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const AdmZip = (() => { try { return require('adm-zip'); } catch(e) { return null; } })();

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function makeBackup(label = 'auto') {
  ensureBackupDir();
  // Включаем миллисекунды (slice(0, 23) вместо 19) + короткий случайный
  // суффикс — иначе два бэкапа, сделанных в один и тот же момент времени
  // (двойной клик, параллельные вызовы), получают одинаковое имя файла
  // и молча перезаписывают друг друга.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const rnd   = uuidv7().slice(0, 6);

  // WAL-чекпоинт перед бэкапом: без него часть данных SQLite могла бы
  // оставаться только в -wal файле, который мы в бэкап не кладём —
  // TRUNCATE сбрасывает весь WAL в основной .sqlite файл и обнуляет его.
  try {
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (e) { /* не блокирующе */ }

  if (AdmZip) {
    // ZIP-архив со всеми файлами данных
    const name = `backup_${label}_${stamp}_${rnd}.zip`;
    const dest = path.join(BACKUP_DIR, name);
    const zip  = new AdmZip();
    const dbSrc     = path.join(DATA_DIR, 'db.json');
    const cfgSrc    = path.join(DATA_DIR, 'config.json');
    const sqliteSrc = path.join(DATA_DIR, 'it-assets.sqlite');
    if (fs.existsSync(dbSrc))     zip.addLocalFile(dbSrc,     '', 'db.json');
    if (fs.existsSync(cfgSrc))    zip.addLocalFile(cfgSrc,    '', 'config.json');
    if (fs.existsSync(sqliteSrc)) zip.addLocalFile(sqliteSrc, '', 'it-assets.sqlite');
    zip.writeZip(dest);
    pruneBackups();
    return { ok: true, file: name, size: fs.statSync(dest).size, format: 'zip' };
  } else {
    // Fallback — только db.json (если adm-zip не установлен)
    const name = `backup_${label}_${stamp}_${rnd}.json`;
    const dest = path.join(BACKUP_DIR, name);
    const dbSrc = path.join(DATA_DIR, 'db.json');
    if (!fs.existsSync(dbSrc)) return { ok: false, error: 'db.json не найден' };
    fs.copyFileSync(dbSrc, dest);
    // Рядом сохраняем config
    const cfgSrc = path.join(DATA_DIR, 'config.json');
    if (fs.existsSync(cfgSrc)) fs.copyFileSync(cfgSrc, dest.replace('.json', '.config.json'));
    // NB: без ZIP (fallback-режим) it-assets.sqlite не бэкапится — это
    // уже известное ограничение fallback-режима (см. предупреждение при
    // восстановлении ниже), не специфично для SQLite.
    pruneBackups();
    return { ok: true, file: name, size: fs.statSync(dest).size, format: 'json' };
  }
}

// Лимиты хранения по типам бэкапов.
// Каждый тип чистится независимо — startup-бэкапы не вытесняют manual.
const BACKUP_LIMITS = {
  auto:          20, // hourly (раз в час)
  startup:       10, // каждый рестарт сервера
  manual:        20, // созданные вручную оператором
  'pre-restore':  5, // автоматические перед восстановлением
};
const BACKUP_LIMIT_DEFAULT = 10; // для неизвестных меток

// SEC-10: помимо лимита по количеству на тип, ограничиваем ещё и суммарный
// размер папки backups/ — иначе большая база (много вложений/учёток) при
// лимите "20 штук на тип" всё равно могла разрастись на несколько
// гигабайт. Настраивается через переменную окружения (читаем её заново на
// каждый вызов, а не один раз при старте — так её можно докрутить без
// перезапуска сервера и это же удобно тестировать).
function _backupMaxTotalBytes() {
  return (parseInt(process.env.IT_ASSETS_BACKUP_MAX_MB) || 2048) * 1024 * 1024; // 2GB по умолчанию
}

function pruneBackups() {
  const allFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => (f.startsWith('backup_') || f.startsWith('db_')) &&
                 (f.endsWith('.json') || f.endsWith('.zip')) &&
                 !f.endsWith('.config.json'));

  // Группируем по метке (второй сегмент: backup_<label>_...)
  const byLabel = {};
  for (const f of allFiles) {
    const m = f.match(/^backup_([^_]+)_/);
    const label = m ? m[1] : 'unknown';
    if (!byLabel[label]) byLabel[label] = [];
    byLabel[label].push({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs });
  }

  const _removeBackupFile = (name) => {
    fs.unlinkSync(path.join(BACKUP_DIR, name));
    const pair = path.join(BACKUP_DIR, name.replace('.json', '.config.json'));
    if (fs.existsSync(pair)) fs.unlinkSync(pair);
  };

  for (const [label, files] of Object.entries(byLabel)) {
    const keep = BACKUP_LIMITS[label] ?? BACKUP_LIMIT_DEFAULT;
    files.sort((a, b) => b.mtime - a.mtime);
    files.slice(keep).forEach(f => _removeBackupFile(f.name));
  }

  // SEC-10: суммарный размер — считаем то, что осталось после чистки по
  // количеству, и при превышении лимита удаляем самые старые файлы по
  // ВСЕЙ папке (не по типу), пока не впишемся. Самый свежий бэкап никогда
  // не трогаем — иначе можно случайно остаться совсем без бэкапов.
  const maxBytes = _backupMaxTotalBytes();
  let remaining = fs.readdirSync(BACKUP_DIR)
    .filter(f => (f.startsWith('backup_') || f.startsWith('db_')) &&
                 (f.endsWith('.json') || f.endsWith('.zip')) &&
                 !f.endsWith('.config.json'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, mtime: st.mtimeMs, size: st.size };
    });

  let total = remaining.reduce((sum, f) => sum + f.size, 0);
  if (total > maxBytes && remaining.length > 1) {
    remaining.sort((a, b) => a.mtime - b.mtime); // старые первыми
    for (const f of remaining) {
      if (total <= maxBytes || remaining.length <= 1) break;
      _removeBackupFile(f.name);
      total -= f.size;
      remaining = remaining.filter(x => x.name !== f.name);
    }
  }
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => (f.startsWith('backup_') || f.startsWith('db_')) &&
                 (f.endsWith('.json') || f.endsWith('.zip')) &&
                 !f.endsWith('.config.json'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      // Определяем что внутри
      const hasConfig = f.endsWith('.zip') ||
        fs.existsSync(path.join(BACKUP_DIR, f.replace('.json', '.config.json')));
      return { name: f, size: st.size, mtime: st.mtime.toISOString(), full: hasConfig };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// INFRA (взято на заметку из atlas-server/backupScheduler.js): там
// автобэкап настраивается через env-переменные (вкл/выкл, интервал,
// сколько хранить). У нас лимит хранения уже настраивается по-другому
// (BACKUP_LIMITS по типам, см. выше) и модель другая — не "раз в сутки в
// заданный час", а "каждые N минут с момента старта", поэтому переносить
// их backupScheduler.js целиком не имеет смысла (у нас и так более развитая
// система: ZIP с БД+конфигом, раздельные лимиты на 4 типа бэкапов,
// глобальный лимит по размеру папки). Взяли только саму идею
// настраиваемости через env — раньше интервал был жёстко зашит на час.
//
// По умолчанию поведение НЕ меняется (включено, раз в час) — это те же
// значения, что были захардкожены раньше, просто теперь переопределяемые.
function isAutoBackupEnabled() {
  const v = process.env.IT_ASSETS_AUTO_BACKUP_ENABLED;
  return v === undefined || v === '' || v === '1' || v.toLowerCase() === 'true';
}
function autoBackupIntervalMs() {
  const min = parseInt(process.env.IT_ASSETS_AUTO_BACKUP_INTERVAL_MIN);
  return (Number.isInteger(min) && min > 0 ? min : 60) * 60 * 1000;
}

// Фоновые таймеры бэкапа отключены в тестах (NODE_ENV=test, Jest выставляет это
// значение автоматически): иначе они реально пишут zip-файлы на диск и стреляют
// уже после teardown окружения Jest, что ломает вывод тестов.
if (process.env.NODE_ENV !== 'test' && isAutoBackupEnabled()) {
  setInterval(() => {
    try {
      const result = makeBackup('auto');
      logger.info('Backup', `auto: ${result.file} (${Math.round(result.size/1024)}KB)`);
    } catch(e) { logger.error('Backup', 'auto failed', e.message); }
  }, autoBackupIntervalMs());

  setTimeout(() => {
    try {
      const result = makeBackup('startup');
      logger.info('Backup', `startup: ${result.file} (${Math.round(result.size/1024)}KB)`);
    } catch(e) { logger.error('Backup', 'startup failed', e.message); }
  }, 10_000);
} else if (process.env.NODE_ENV !== 'test') {
  logger.info('Backup', 'автобэкап выключен (IT_ASSETS_AUTO_BACKUP_ENABLED=0) — только вручную/при старте');
}

app.get('/api/backup/list', requireAuth, (req, res) => {
  try { res.json(listBackups()); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backup/create', requireAuth, (req, res) => {
  try { res.json(makeBackup('manual')); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backup/download/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл не найден' });
  res.download(file, name);
});

// SEC-6: базовая проверка, что файл действительно похож на бэкап it-assets,
// прежде чем перезаписывать им живые данные. Не полноценная JSON-схема
// (это SEC-9, отдельная задача) — только защита от явно мусорного/битого
// содержимого: невалидный JSON, чужой формат файла, битая сигнатура sqlite.
function _validateDbJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error('db.json в бэкапе повреждён или не является валидным JSON'); }
  if (!parsed || !Array.isArray(parsed.assets) || !Array.isArray(parsed.history))
    throw new Error('db.json в бэкапе не похож на бэкап it-assets (нет assets[]/history[])');
  return parsed;
}
function _validateConfigJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error('config.json в бэкапе повреждён или не является валидным JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.settings !== 'object')
    throw new Error('config.json в бэкапе не похож на бэкап it-assets (нет объекта settings)');
  return parsed;
}
function _validateSqliteHeader(buf) {
  const header = buf.slice(0, 16).toString('utf8');
  if (header !== 'SQLite format 3\u0000')
    throw new Error('it-assets.sqlite в бэкапе повреждён (неверная сигнатура файла)');
}

app.post('/api/backup/restore/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл не найден' });
  try {
    if (name.endsWith('.zip') && AdmZip) {
      const zip = new AdmZip(file);
      const entries = zip.getEntries();
      const dbEntry     = entries.find(e => e.entryName === 'db.json');
      const configEntry = entries.find(e => e.entryName === 'config.json');
      const sqliteEntry = entries.find(e => e.entryName === 'it-assets.sqlite');

      // Проверяем ДО любой записи на диск — если что-то не так, restore
      // отменяется целиком, живые файлы не трогаются.
      if (dbEntry)     _validateDbJson(dbEntry.getData().toString('utf8'));
      if (configEntry) _validateConfigJson(configEntry.getData().toString('utf8'));
      if (sqliteEntry) _validateSqliteHeader(sqliteEntry.getData());

      makeBackup('pre-restore'); // сохраняем текущее состояние

      if (dbEntry)     zip.extractEntryTo('db.json',     DATA_DIR, false, true);
      if (configEntry) zip.extractEntryTo('config.json', DATA_DIR, false, true);
      // Старые бэкапы (до Фазы 7c) не содержат it-assets.sqlite — это
      // нормально, тогда SQL-таблицы просто останутся как были на диске.
      if (sqliteEntry) {
        zip.extractEntryTo('it-assets.sqlite', DATA_DIR, false, true);
        // WAL/SHM-файлы предыдущей сессии больше не соответствуют
        // восстановленному основному файлу — удаляем, чтобы SQLite не
        // попытался применить их поверх при следующем открытии.
        for (const suffix of ['-wal', '-shm']) {
          const stale = path.join(DATA_DIR, 'it-assets.sqlite' + suffix);
          if (fs.existsSync(stale)) fs.unlinkSync(stale);
        }
      }
      res.json({
        ok: true, restored: name, full: true,
        note: 'Изменения вступят в силу после перезапуска сервера (как и для db.json/config.json).',
      });
    } else {
      // Fallback — только db.json
      const raw = fs.readFileSync(file, 'utf8');
      _validateDbJson(raw);

      const cfgBak = file.replace('.json', '.config.json');
      const hasCfg = fs.existsSync(cfgBak);
      if (hasCfg) _validateConfigJson(fs.readFileSync(cfgBak, 'utf8'));

      makeBackup('pre-restore');
      fs.copyFileSync(file, path.join(DATA_DIR, 'db.json'));
      if (hasCfg) {
        fs.copyFileSync(cfgBak, path.join(DATA_DIR, 'config.json'));
        res.json({ ok: true, restored: name, full: true });
      } else {
        res.json({ ok: true, restored: name, full: false,
          warn: 'config.json не восстановлен — бэкап содержит только db.json' });
      }
    }
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ─── QR CODE ─────────────────────────────────────────────────────────────────
// Используем npm qrcode если установлен (npm install), иначе самописный fallback

let _qrLib = null;
try {
  _qrLib = require('qrcode');
  logger.info('QR', 'using npm qrcode');
} catch(e) {
  logger.info('QR', 'npm qrcode not found, using built-in generator');
}

// Встроенный генератор (fallback) ─────────────────────────────────────────────
const _GF_EXP = new Uint8Array(512);
const _GF_LOG = new Uint8Array(256);
(function(){
  let x = 1;
  for (let i = 0; i < 255; i++) {
    _GF_EXP[i] = x; _GF_LOG[x] = i;
    x <<= 1; if (x & 256) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) _GF_EXP[i] = _GF_EXP[i - 255];
})();
function _gfMul(a,b){ return (!a||!b)?0:_GF_EXP[(_GF_LOG[a]+_GF_LOG[b])%255]; }
function _rsGen(deg){ let r=new Uint8Array(deg+1); r[deg]=1; let root=1; for(let i=0;i<deg;i++){ for(let j=0;j<deg;j++) r[j]=_gfMul(r[j],root)^r[j+1]; r[deg]=_gfMul(r[deg],root); root=_gfMul(root,2); } return r; }
function _rsEncode(data,ecLen){ const gen=_rsGen(ecLen),res=new Uint8Array(data.length+ecLen); data.forEach((b,i)=>res[i]=b); for(let i=0;i<data.length;i++){ const c=res[i]; if(c) for(let j=0;j<gen.length;j++) res[i+j]^=_gfMul(gen[j],c); } return res.slice(data.length); }
function _utf8(str){ const b=[]; for(let i=0;i<str.length;i++){ const c=str.charCodeAt(i); if(c<0x80)b.push(c); else if(c<0x800){b.push(0xC0|(c>>6));b.push(0x80|(c&0x3F));} else{b.push(0xE0|(c>>12));b.push(0x80|((c>>6)&0x3F));b.push(0x80|(c&0x3F));} } return b; }

const _VER=[null,[16,10],[28,16],[44,26],[64,18],[86,24],[108,16],[124,18],[154,22],[182,22],[216,26]];
const _ALIGN=[[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
const _FMT_MASK=0b101010000010010;

function _makeQRSvg(text) {
  const bytes = _utf8(text);
  let ver = 1;
  while (ver <= 10 && _VER[ver][0] < bytes.length + 3) ver++;
  if (ver > 10) throw new Error('Text too long');
  const [dataCap, ecLen] = _VER[ver];
  const size = ver * 4 + 17;
  const bits = [];
  const pb = (v,n) => { for(let i=n-1;i>=0;i--) bits.push((v>>i)&1); };
  pb(4,4); pb(bytes.length,8); bytes.forEach(b=>pb(b,8)); pb(0,4);
  while(bits.length%8) bits.push(0);
  const pads=[0xEC,0x11]; let pi=0;
  while(bits.length<dataCap*8){pb(pads[pi&1],8);pi++;}
  const data=new Uint8Array(dataCap);
  for(let i=0;i<dataCap;i++) for(let j=0;j<8;j++) data[i]|=bits[i*8+j]<<(7-j);
  const ec=_rsEncode(data,ecLen);
  const cw=[...data,...ec];
  const M=Array.from({length:size},()=>new Int8Array(size).fill(-1));
  const F=Array.from({length:size},()=>new Uint8Array(size));
  const sf=(r,c,v)=>{if(r>=0&&r<size&&c>=0&&c<size){M[r][c]=v;F[r][c]=1;}};
  const addFinder=(row,col)=>{for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++){const v=(r>=0&&r<=6&&(r===0||r===6||c===0||c===6))||(r>=2&&r<=4&&c>=2&&c<=4)?1:0;sf(row+r,col+c,v);}};
  addFinder(0,0);addFinder(0,size-7);addFinder(size-7,0);
  for(let i=8;i<size-8;i++){sf(6,i,i%2?0:1);sf(i,6,i%2?0:1);}
  sf(4*ver+9,8,1);
  const ap=_ALIGN[ver];
  for(const ar of ap)for(const ac of ap){if(F[ar][ac])continue;for(let r=-2;r<=2;r++)for(let c=-2;c<=2;c++)sf(ar+r,ac+c,(Math.abs(r)===2||Math.abs(c)===2||(!r&&!c))?1:0);}
  const plFmt=(mi)=>{const d=(0b01<<3)|mi;let rem=d;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>9)*0x537);const fmt=((d<<10)|rem)^_FMT_MASK;const p=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];const p2=[[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];for(let i=0;i<15;i++){const b=(fmt>>(14-i))&1;sf(...p[i],b);sf(...p2[i],b);}};
  const MASKS=[(r,c)=>(r+c)%2===0,(r,c)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,(r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>(r*c)%2+(r*c)%3===0,(r,c)=>((r*c)%2+(r*c)%3)%2===0,(r,c)=>((r+c)%2+(r*c)%3)%2===0];
  const Fc=F.map(r=>new Uint8Array(r));
  let bestM=0,bestP=Infinity,bestMat=null;
  for(let mi=0;mi<8;mi++){
    const tryM=M.map(r=>new Int8Array(r));
    for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(!Fc[r][c])tryM[r][c]=-1;
    let bi=0;
    for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++){for(let dc=0;dc<2;dc++){const c=right-dc,r=((right+1)&2)?vert:size-1-vert;if(Fc[r][c])continue;const bit=bi<cw.length*8?(cw[bi>>3]>>(7-(bi&7)))&1:0;bi++;tryM[r][c]=bit^(MASKS[mi](r,c)?1:0);}}}
    let p=0;
    for(let r=0;r<size;r++){for(let run=0,c=0;c<size;c++){if(c>0&&tryM[r][c]===tryM[r][c-1]){run++;if(run===4)p+=3;else if(run>4)p++;}else run=0;}}
    for(let c=0;c<size;c++){for(let run=0,r=0;r<size;r++){if(r>0&&tryM[r][c]===tryM[r-1][c]){run++;if(run===4)p+=3;else if(run>4)p++;}else run=0;}}
    for(let r=0;r<size-1;r++)for(let c=0;c<size-1;c++)if(tryM[r][c]===tryM[r+1][c]&&tryM[r][c]===tryM[r][c+1]&&tryM[r][c]===tryM[r+1][c+1])p+=3;
    let dark=0;tryM.forEach(row=>row.forEach(v=>{if(v===1)dark++;}));
    p+=Math.abs(Math.round(dark/(size*size)*100/5)*5-50)/5*10;
    if(p<bestP){bestP=p;bestM=mi;bestMat=tryM;}
  }
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)M[r][c]=bestMat[r][c];
  plFmt(bestM);
  const quiet=4,cell=10,svgSz=(size+quiet*2)*cell;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${svgSz}" height="${svgSz}" viewBox="0 0 ${svgSz} ${svgSz}"><rect width="${svgSz}" height="${svgSz}" fill="white"/>`;
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(M[r][c]===1)svg+=`<rect x="${(c+quiet)*cell}" y="${(r+quiet)*cell}" width="${cell}" height="${cell}" fill="black"/>`;
  svg+='</svg>';
  return svg;
}
// ─── конец встроенного генератора ────────────────────────────────────────────

app.get('/api/qr', async (req, res) => {
  const text = (req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    if (_qrLib) {
      // npm qrcode — проверен, даёт корректные коды
      const svg = await _qrLib.toString(text, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(svg);
    }
    // Fallback — встроенный генератор
    const svg = _makeQRSvg(text);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html')));

// ─── Глобальный обработчик ошибок ─────────────────────────────────────────────
// Без него необработанные исключения (например, синтаксически неверный JSON
// в теле запроса — body-parser бросает SyntaxError) уходят в дефолтный
// обработчик Express, который вне NODE_ENV=production отдаёт клиенту полный
// stack trace с абсолютными путями на диске — раскрытие внутренней структуры
// сервера без какой-либо авторизации. Здесь — то же самое, но без утечки:
// подробности только в серверный лог, клиенту — краткое сообщение.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('unhandled', err.message || String(err), err.stack);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const message = status === 400 ? 'Некорректное тело запроса' : 'Внутренняя ошибка сервера';
  res.status(status).json({ error: message });
});

module.exports = app;

if (require.main === module) {
  (async function startServer() {
    const https   = require('https');
    const http    = require('http');
    const { ensureCert, getLocalIPs } = require('./cert');

    const HTTP_PORT  = process.env.PORT       || 3000;
    const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

    function printStartInfo(ips) {
      const fs2    = require('fs');
      const dbPath = require('./db/store').DB_PATH;

      // INFRA-4/9 (взято на заметку из соседнего atlas-server): обрамляем
      // вывод рамкой из '─', как там сделано в server.js/printBanner —
      // визуально проще выцепить блок старта среди прочих логов в
      // консоли/PM2. Сама диагностика (проверка прав на запись, размер БД,
      // самопроверка записи в SQLite) — оставлена как была, только обёрнута.
      const rule = '─'.repeat(60);
      console.log('\n' + rule);
      console.log(' 🗄️  IT ASSETS ' + APP_VERSION_DISPLAY + ' — сервер запущен');
      console.log(rule);
      console.log('DB path: ' + dbPath);

      if (fs2.existsSync(dbPath)) {
        const stat = fs2.statSync(dbPath);
        console.log('DB size: ' + (stat.size/1024).toFixed(1) + ' KB  | modified: ' + stat.mtime.toLocaleString('ru-RU'));
      } else {
        console.log('DB: file will be created on first write');
      }

      try {
        fs2.accessSync(require('path').dirname(dbPath), fs2.constants.W_OK);
      } catch(e) {
        console.error('\n!!! CRITICAL: no write permission for data/ folder');
        console.error('!!! Move it-assets folder to Desktop and restart!\n');
        logger.error('startup', 'no write permission for data/ folder', e.message);
      }

      // Фаза 7c-8b: assets/history переехали в SQLite — db.json больше не
      // отражает их состояние (пишется, только пока там ещё остаются
      // organizations/filials/... до их будущей миграции, если будет).
      // Проверяем реальную запись через SQLite: heartbeat-таймстамп в
      // settings + перечитываем — если файл недоступен на запись, это
      // выбросит исключение так же надёжно, как раньше делала db.write().
      try {
        db.set('_meta.last_start', new Date().toISOString()).write();
        db.setSetting('_last_start_check', new Date().toISOString());
        const check = db.getSetting('_last_start_check');
        const assetsCount  = sqlite.prepare('SELECT COUNT(*) c FROM assets').get().c;
        const historyCount = sqlite.prepare('SELECT COUNT(*) c FROM history').get().c;
        if (!check) {
          console.error('!!! WARNING: SQLite write check failed (readback empty)');
          logger.warn('startup', 'SQLite write check failed: readback empty after write');
        } else {
          console.log('DB write: OK (' + assetsCount + ' assets, ' + historyCount + ' history)');
        }
      } catch(e) {
        console.error('!!! db write ERROR:', e.message);
        logger.error('startup', 'db write ERROR', e.message);
      }

      const total = sqlite.prepare("SELECT COUNT(*) c FROM assets WHERE status != 'списан'").get().c;
      console.log('Assets: ' + total);
      console.log('');
      console.log('HTTP  (redirect to HTTPS):');
      console.log('  http://localhost:' + HTTP_PORT);
      console.log('');
      console.log('HTTPS (main):');
      console.log('  https://localhost:' + HTTPS_PORT);
      for (const ip of ips.filter(i => i !== '127.0.0.1'))
        console.log('  https://' + ip + ':' + HTTPS_PORT + '  <-- colleagues');
      console.log('');
      console.log('  [WARNING] Self-signed certificate');
      console.log('  Chrome:  click "Advanced" -> "Proceed to localhost"');
      console.log('  Firefox: click "Accept the Risk and Continue"');
      console.log('  Edge:    click "Advanced" -> "Continue to localhost"');
      console.log('\n  Чтобы остановить сервер — нажмите Ctrl+C.\n');
      console.log(rule + '\n');
    }

    // HTTP -> HTTPS redirect
    const httpApp = require('express')();
    httpApp.use((req, res) => {
      const host = req.hostname || 'localhost';
      res.redirect(301, 'https://' + host + ':' + HTTPS_PORT + req.originalUrl);
    });
    http.createServer(httpApp).listen(HTTP_PORT, '0.0.0.0', () => {
      console.log('[HTTP]  :' + HTTP_PORT + ' -> redirect to HTTPS :' + HTTPS_PORT);
    });

    // HTTPS server
    let tlsOptions;
    try {
      tlsOptions = await ensureCert();
    } catch(e) {
      console.error('[TLS] Failed to get certificate:', e.message);
      console.error('[TLS] Starting HTTP only on port ' + HTTP_PORT);
      logger.error('TLS', 'Failed to get certificate, falling back to HTTP only', e.message);
      app.listen(HTTP_PORT, '0.0.0.0', () => {
        const ips = getLocalIPs();
        const rule = '─'.repeat(60);
        console.log('\n' + rule);
        console.log(' 🗄️  IT ASSETS ' + APP_VERSION_DISPLAY + ' — сервер запущен (HTTP, без TLS)');
        console.log(rule);
        console.log('  http://localhost:' + HTTP_PORT);
        for (const ip of ips.filter(i => i !== '127.0.0.1'))
          console.log('  http://' + ip + ':' + HTTP_PORT);
        console.log(rule + '\n');
      });
      return;
    }

    const ips = getLocalIPs();
    https.createServer(tlsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      printStartInfo(ips);
    });
  })();
}
