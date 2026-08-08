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
  PORT, DATA_DIR, DB_FILE, CERT_FILE, KEY_FILE, AUTH_ENABLED,
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
app.use(express.json({ limit: '20mb' }));
// Отдельный маленький лимит для settings (логотип max 512KB base64 ≈ 380KB файл)
app.use('/api/settings', express.json({ limit: '600kb' }));

// Suppress favicon 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Static with cache headers
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'zakupki.html'));
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', require('./src/routes/auth')(strictLimiter));
app.use('/api', require('./src/routes/orgs'));
app.use('/api', require('./src/routes/requests'));
app.use('/api', require('./src/routes/files'));
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
async function ensureXlsx() {
  const dest = path.join(__dirname, 'public', 'xlsx.full.min.js');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100_000) return;
  // xlsx-js-style is a drop-in SheetJS replacement with full cellStyles support
  const url = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
  console.log('[xlsx] Скачиваю xlsx-js-style локально...');
  try {
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', e => { fs.unlink(dest, () => {}); reject(e); });
    });
    console.log('[xlsx] Готово — xlsx-js-style сохранён в public/');
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

  if (hasCert && fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    const sslOpts = {
      key:  fs.readFileSync(KEY_FILE,  'utf8'),
      cert: fs.readFileSync(CERT_FILE, 'utf8'),
    };
    https.createServer(sslOpts, app).listen(PORT, '0.0.0.0', () => printBanner('https'));
    // HTTP редирект на HTTPS
    const HTTP_PORT = PORT + 1;
    http.createServer((req, res) => {
      const host = req.headers.host ? req.headers.host.replace(/:\d+$/, '') : 'localhost';
      res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` });
      res.end();
    }).listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`[HTTP→HTTPS] Редирект с порта ${HTTP_PORT} на ${PORT}`);
    });
  } else {
    app.listen(PORT, '0.0.0.0', () => printBanner('http'));
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
