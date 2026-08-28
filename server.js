const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const https      = require('https');
const http       = require('http');

let cookieParser;
try { cookieParser = require('cookie-parser'); } catch(e) { cookieParser = null; }
let helmet;
try { helmet = require('helmet'); } catch(e) { helmet = null; }

const rateLimit   = require('express-rate-limit');
const morgan      = require('morgan');
const compression = require('compression');

const {
  PORT, BIND_HOST, DATA_DIR, DB_FILE, CERT_FILE, KEY_FILE, AUTH_ENABLED,
} = require('./src/config');
const { ensureCert } = require('./src/certs');
const { initDb, getDb } = require('./src/db/connection');
const { doBackup } = require('./src/services/backupService');
const { BACKUP_DIR } = require('./src/config');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(compression());
if (cookieParser) app.use(cookieParser());

// Request logging
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
const accessLog = fs.createWriteStream(path.join(logsDir, 'access.log'), { flags: 'a' });
app.use(morgan('combined', { stream: accessLog }));
// Console logging only in development — in production Docker logs go to file only
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Security headers
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"],
        scriptSrcAttr: ["'unsafe-inline'"], // allow onclick="..." / onkeydown="..." used throughout the UI
        styleSrc:    ["'self'", "'unsafe-inline'"],
        styleSrcAttr: ["'unsafe-inline'"], // allow style="..." attributes used throughout the UI
        imgSrc:      ["'self'", "data:", "blob:"],
        connectSrc:  ["'self'"],
        fontSrc:     ["'self'", "data:"],
        objectSrc:   ["'none'"],
        frameSrc:    ["'none'"],
        baseUri:     ["'self'"],
        formAction:  ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));
}

// CORS — только локальная сеть
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(origin);
    cb(local ? null : new Error('Not allowed by CORS'), local);
  },
  credentials: true,
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 120,            // 120 запросов/мин на IP
  // Полный Playwright-набор открывает страницу десятки раз с одного
  // localhost-IP и намеренно проверяет несколько ролей. Это превышает
  // боевой лимит ещё до конца набора и делает E2E нестабильным. В test
  // окружении, которое задаётся только playwright.config.js, лимитер
  // отключён; в development/production он работает без изменений.
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // для auth и restore
  message: { error: 'Слишком много попыток' },
});
app.use('/api/', apiLimiter);

// Body parsers
// ВАЖНО (найдено при аудите): раньше здесь стоял ГЛОБАЛЬНЫЙ express.json({limit:'20mb'})
// на все /api/*, а некоторые роуты (layout-files, signed-spec и др.) пытались
// переопределить лимит своим собственным express.json(...) прямо на роуте.
// Это не работает: Express/body-parser не перечитывает уже потреблённый поток
// запроса, поэтому реально применяется только ПЕРВЫЙ парсер, вставший в цепочку
// раньше остальных — а это всегда был глобальный. Проверено на практике:
// layout-files с заявленным лимитом 50mb на деле обрывался на 20mb (413),
// а /api/settings с заявленным лимитом 600kb на деле пропускал body почти
// до 20mb (спасала только ручная проверка длины поля logoBase64 внутри
// самого роута, а не парсер).
//
// Правильный порядок: сначала монтируем роутер с файловыми загрузками
// (routes/files.js) — там каждый POST сам объявляет свой express.json(limit),
// и раз это первый парсер, тронувший тело запроса, он реально работает.
// Затем — точечный лимит для /api/settings. И только потом — общий дефолт
// для всех остальных /api-роутов (orgs, requests, auth, backup/restore,
// docx, bitrix), которые сами парсер не объявляют.
app.use('/api', require('./src/routes/files'));
app.use('/api/settings', express.json({ limit: '600kb' }));
app.use('/api', express.json({ limit: '15mb' }));

// Suppress favicon 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Static with cache headers.
// ВАЖНО: maxAge:'1h' означает, что браузер целый час НЕ ходит на сервер
// вообще — даже проверить, изменился ли файл. После любого обновления
// public/js/*.js или .html пользователь видит старую версию до жёсткого
// обновления страницы (Ctrl+F5) или истечения часа — источник целой
// серии «я же исправил, а всё равно не работает» на практике. Меняем на
// no-cache: браузер каждый раз спрашивает сервер «не изменилось ли?»
// (дешёвый 304, если файл тот же) вместо слепого доверия кэшу.
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: true,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache'); },
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'zakupki.html'));
});

// Страница сброса пароля — открывается по ссылке из письма (/reset-password?token=...)
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// ── Routes ────────────────────────────────────────────────────────────────────
// (routes/files уже смонтирован выше — см. секцию Body parsers, порядок там критичен)
app.use('/api', require('./src/routes/auth')(strictLimiter));
app.use('/api', require('./src/routes/orgs'));
app.use('/api', require('./src/routes/requests'));
app.use('/api', require('./src/routes/backup')(strictLimiter));
const { router: settingsRouter, PKG_VERSION } = require('./src/routes/settings');
app.use('/api', settingsRouter);
app.use('/api', require('./src/routes/docx'));
app.use('/api', require('./src/routes/bitrix'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  try {
    const row = getDb().exec('SELECT COUNT(*) as c FROM requests')[0];
    const count = row ? row.values[0][0] : 0;
    res.json({ status: 'ok', version: PKG_VERSION, requests: count, uptime: Math.floor(process.uptime()) });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── 404 / Error handler middleware (must be LAST) ─────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Маршрут не найден: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Внутренняя ошибка сервера';
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.stack || err);
  res.status(status).json({ error: message });
});

// ── Ensure local XLSX copy ────────────────────────────────────────────────────
// Уязвимость (найдена при аудите): раньше файл качался напрямую с
// cdn.jsdelivr.net без ЛЮБОЙ проверки целостности — компрометация jsDelivr
// или MITM на этом конкретном запросе привели бы к тому, что сервер сам
// разложит вредоносный JS в свою же публичную папку, откуда он раздаётся
// всем пользователям приложения. Версия была зафиксирована (@1.2.0), но это
// не защищает от подмены конкретного файла на CDN.
//
// Фикс: качаем не JS-файл с CDN-зеркала, а официальный npm-тарбол пакета с
// registry.npmjs.org (тот же источник, которому мы и так уже доверяем для
// npm install/npm ci) и сверяем его SHA-512 с контрольной суммой, которую
// сам registry публикует в метаданных пакета (integrity, формат SRI) —
// значение зафиксировано здесь в коде, а не берётся динамически из ответа
// registry на неё же: так подмена ответа registry для ОДНОГО этого запроса
// (в отличие от компрометации самого пакета в самом registry, что —
// отдельная и гораздо более редкая угроза) ничего не даёт атакующему, он
// не может подсунуть свой файл вместе с «подходящей» контрольной суммой.
const XLSX_PKG_VERSION = '1.2.0';
const XLSX_TARBALL_URL = `https://registry.npmjs.org/xlsx-js-style/-/xlsx-js-style-${XLSX_PKG_VERSION}.tgz`;
// SHA-512 (base64, SRI-формат) — сверено вручную с published integrity для
// xlsx-js-style@1.2.0 на registry.npmjs.org на момент фиксации версии.
const XLSX_TARBALL_SHA512 = 'DDT4FXFSWfT4DXMSok/m3TvmP1gvO3dn0Eu/c+eXHW5Kzmp7IczNkxg/iEPnImbG9X0Vb8QhROda5eatSR/97Q==';
const XLSX_TARBALL_INNER_PATH = 'package/dist/xlsx.bundle.js';

// Минимальный разбор USTAR-архива (все npm-тарболы — обычный .tar.gz) без
// внешней зависимости: ищем один конкретный файл по пути внутри архива.
// Формат tar — фиксированные 512-байтные блоки заголовков; см.
// https://www.gnu.org/software/tar/manual/html_node/Standard.html
function extractFileFromTarGz(gzBuf, innerPath) {
  const zlib = require('zlib');
  const tarBuf = zlib.gunzipSync(gzBuf);
  let offset = 0;
  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break; // конец архива — два нулевых блока подряд
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    offset += 512;
    if (name === innerPath) {
      return tarBuf.subarray(offset, offset + size);
    }
    offset += Math.ceil(size / 512) * 512; // содержимое файла тоже выровнено по 512 байт
  }
  return null;
}

async function ensureXlsx() {
  const dest = path.join(__dirname, 'public', 'xlsx.full.min.js');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100_000) return;
  throw new Error('Не найден обязательный локальный файл public/xlsx.full.min.js');
  console.log('[xlsx] Скачиваю xlsx-js-style локально (с проверкой контрольной суммы)...');
  try {
    const tarball = await new Promise((resolve, reject) => {
      const chunks = [];
      https.get(XLSX_TARBALL_URL, res => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });

    const actualSha512 = require('crypto').createHash('sha512').update(tarball).digest('base64');
    if (actualSha512 !== XLSX_TARBALL_SHA512) {
      throw new Error(
        `Контрольная сумма не совпадает — ожидалось sha512-${XLSX_TARBALL_SHA512}, ` +
        `получено sha512-${actualSha512}. Файл НЕ будет использован.`
      );
    }

    const fileBuf = extractFileFromTarGz(tarball, XLSX_TARBALL_INNER_PATH);
    if (!fileBuf) throw new Error(`Файл ${XLSX_TARBALL_INNER_PATH} не найден внутри тарбола`);

    fs.writeFileSync(dest, fileBuf);
    console.log('[xlsx] Готово — xlsx-js-style сохранён в public/ (контрольная сумма проверена)');
  } catch(e) {
    console.warn('[xlsx] Не удалось скачать локально, будет использован CDN:', e.message);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
}

initDb().then(async () => {
  await ensureXlsx();
  const hasCert = ensureCert();

  // Первый бэкап через 10с после старта
  setTimeout(doBackup, 10000);
  // Бэкап каждые 6 часов
  const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL_MS || String(6 * 60 * 60 * 1000));
  setInterval(doBackup, BACKUP_INTERVAL);

  // Очистка истёкших сессий каждый час
  setInterval(() => {
    try {
      getDb().run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
      require('./src/db/connection').saveDb();
    } catch(e) { console.error('[sessions] cleanup error:', e.message); }
  }, 60 * 60 * 1000);

  const ips = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }

  function printBanner(proto) {
    console.log('\n══════════════════════════════════════════');
    console.log('  🚀 procure-it — сервер запущен');
    console.log('══════════════════════════════════════════');
    console.log(`  Протокол:    ${proto.toUpperCase()}`);
    console.log(`  Локально:    ${proto}://localhost:${PORT}`);
    ips.forEach(ip => console.log(`  По сети:     ${proto}://${ip}:${PORT}`));
    console.log(`  База данных: ${DB_FILE}`);
    console.log(`  Авторизация: ${AUTH_ENABLED ? '✓ Включена (пароль задан)' : '✗ Выключена (PROCURE_PASSWORD не задан)'}`);
    console.log(`  Логи:        ${path.join(__dirname, 'logs', 'access.log')}`);
    if (!AUTH_ENABLED) {
      console.log('');
      console.log('  ⚠️  Для включения пароля установите переменную:');
      console.log('     Windows: set PROCURE_PASSWORD=yourpassword');
      console.log('     Linux:   PROCURE_PASSWORD=yourpassword node server.js');
    }
    if (proto === 'https') {
      console.log('');
      console.log('  ⚠️  Первый раз браузер покажет предупреждение');
      console.log('     «Не защищено» — нажми «Дополнительно» → «Перейти»');
      console.log(`  📄 Сертификат: ${CERT_FILE}`);
    }
    console.log('══════════════════════════════════════════\n');
  }

  // Уязвимость/находка аудита (см. также fileLayoutService.js): раньше
  // start.bat открывал браузер по фиксированному таймеру (`timeout /t 3`)
  // ПАРАЛЛЕЛЬНО со стартом сервера — гонка, а не гарантия. Если сервер
  // стартовал дольше 3с (генерация сертификата, инициализация БД на
  // первом запуске), браузер открывался раньше, чем сервер начинал
  // слушать порт, и показывал ошибку подключения. Здесь же — колбэк
  // `.listen()`, единственное место, где сервер ДЕЙСТВИТЕЛЬНО готов
  // принимать соединения, так что гонка исключена структурно. Работает
  // только когда PROCURE_AUTO_OPEN=1 (выставляет start.bat/start.sh
  // сами) — при обычном `node server.js` (Docker, systemd, headless)
  // открывать браузер не нужно и не должно. execFile (не exec) — тот же
  // приём, что и в fileLayoutService.js: URL здесь целиком server-side
  // константа, не пользовательский ввод, но лишний повод для shell-
  // интерполяции всё равно ни к чему.
  function maybeOpenBrowser(url) {
    if (process.env.PROCURE_AUTO_OPEN !== '1') return;
    try {
      const { execFile } = require('child_process');
      if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '""', url]);
      else if (process.platform === 'darwin') execFile('open', [url]);
      else execFile('xdg-open', [url]);
    } catch(e) { /* не критично — сервер уже поднят, URL напечатан в баннере */ }
  }

  if (hasCert && fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    const sslOpts = {
      key:  fs.readFileSync(KEY_FILE,  'utf8'),
      cert: fs.readFileSync(CERT_FILE, 'utf8'),
    };
    https.createServer(sslOpts, app).listen(PORT, BIND_HOST, () => { printBanner('https'); maybeOpenBrowser(`https://localhost:${PORT}`); });
    // HTTP редирект на HTTPS
    const HTTP_PORT = PORT + 1;
    http.createServer((req, res) => {
      // Уязвимость (найдена при аудите): host бралcя из заголовка Host запроса
      // почти без проверки — только отрезался порт. Host полностью
      // контролируется клиентом и может содержать что угодно (перевод строки,
      // произвольные символы), что попадало прямо в заголовок Location.
      // Реального перехода на чужой домен это не давало — редирект всё равно
      // идёт на этот же сервер и порт (${PORT} — серверная константа, не из
      // запроса) — но собирать HTTP-заголовок из непроверенного пользовательского
      // ввода в принципе не стоит: любая будущая правка рядом (например, если
      // порт когда-нибудь тоже начнут брать из запроса) молча унаследует ту же
      // дыру. Разрешаем только символы, допустимые в hostname/IPv4/IPv6
      // (буквы, цифры, точки, дефисы, двоеточия для IPv6 в квадратных скобках);
      // всё остальное — отбрасываем и уходим на localhost.
      const SAFE_HOST = /^[A-Za-z0-9.\-\[\]:]+$/;
      const rawHost = req.headers.host ? req.headers.host.replace(/:\d+$/, '') : '';
      const host = SAFE_HOST.test(rawHost) ? rawHost : 'localhost';
      res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` });
      res.end();
    }).listen(HTTP_PORT, BIND_HOST, () => {
      console.log(`[HTTP→HTTPS] Редирект с порта ${HTTP_PORT} на ${PORT}`);
    });
  } else {
    app.listen(PORT, BIND_HOST, () => { printBanner('http'); maybeOpenBrowser(`http://localhost:${PORT}`); });
  }
}).catch(e => { console.error('DB init error:', e); process.exit(1); });

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Завершение работы...`);
  try {
    const db = getDb();
    if (db) {
      // Flush WAL to main file before closing
      db.run('PRAGMA wal_checkpoint(TRUNCATE)');
      const data = db.export();
      fs.writeFileSync(DB_FILE, Buffer.from(data));
      db.close();
      console.log('[DB] База данных сохранена и закрыта');
    }
  } catch(e) {
    console.error('[DB] Ошибка при закрытии:', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Save DB on uncaught exceptions too
process.on('uncaughtException', (err) => {
  console.error('[FATAL]', err);
  gracefulShutdown('uncaughtException');
});
