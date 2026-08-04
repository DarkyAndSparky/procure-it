const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const https      = require('https');
const http       = require('http');
const initSqlJs  = require('sql.js');

let cookieParser;
try { cookieParser = require('cookie-parser'); } catch(e) { cookieParser = null; }
let helmet;
try { helmet = require('helmet'); } catch(e) { helmet = null; }
let selfsigned;
try { selfsigned = require('selfsigned'); } catch(e) { selfsigned = null; }

const rateLimit   = require('express-rate-limit');
const morgan      = require('morgan');
const compression = require('compression');

const app      = express();
const PORT     = parseInt(process.env.PORT || '9111');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'zakupki.db');
const CERT_DIR = path.join(DATA_DIR, 'certs');
const SIGNED_DIR = path.join(DATA_DIR, 'signed_specs');

// ── Ensure dirs ───────────────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(CERT_DIR))   fs.mkdirSync(CERT_DIR, { recursive: true });
if (!fs.existsSync(SIGNED_DIR)) fs.mkdirSync(SIGNED_DIR, { recursive: true });

// ── Self-signed cert ──────────────────────────────────────────────────────────
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE  = path.join(CERT_DIR, 'key.pem');

function ensureCert() {
  // Validate existing cert
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    try {
      const k = fs.readFileSync(KEY_FILE,  'utf8');
      const c = fs.readFileSync(CERT_FILE, 'utf8');
      if (k.includes('BEGIN') && c.includes('BEGIN')) {
        console.log('[HTTPS] Сертификат найден и валиден');
        return true;
      }
    } catch(e) {}
    console.log('[HTTPS] Сертификат повреждён, пересоздаём...');
    try { fs.unlinkSync(KEY_FILE);  } catch(e) {}
    try { fs.unlinkSync(CERT_FILE); } catch(e) {}
  }

  console.log('[HTTPS] Генерация самоподписанного сертификата...');

  // ── Strategy 1: openssl (Git for Windows / Linux / macOS) ──────────────────
  try {
    const { execSync } = require('child_process');

    // Check openssl available
    execSync('openssl version', { stdio: 'pipe' });

    const opensslCmd = [
      'openssl req -x509 -newkey rsa:2048 -nodes',
      `-keyout "${KEY_FILE}"`,
      `-out "${CERT_FILE}"`,
      '-days 3650',
      '-sha256',
      '-subj "/CN=localhost/O=procure-it/C=RU"',
      `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
    ].join(' ');

    execSync(opensslCmd, { stdio: 'pipe' });

    // Verify
    const k = fs.readFileSync(KEY_FILE,  'utf8');
    const c = fs.readFileSync(CERT_FILE, 'utf8');
    if (k.includes('BEGIN') && c.includes('BEGIN')) {
      console.log('[HTTPS] ✓ Сертификат создан через openssl');
      return true;
    }
  } catch(e) {
    console.log('[HTTPS] openssl недоступен, пробуем selfsigned...');
  }

  // ── Strategy 2: selfsigned npm package ─────────────────────────────────────
  if (selfsigned) {
    try {
      const attrs = [
        { name: 'commonName',       value: 'localhost' },
        { name: 'organizationName', value: 'procure-it' },
        { name: 'countryName',      value: 'RU' },
      ];
      const opts = {
        days: 3650,
        algorithm: 'sha256',
        keySize: 2048,
        extensions: [{
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        }],
      };
      const pems = selfsigned.generate(attrs, opts);

      // Normalize line endings (critical on Windows)
      const normalize = (s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() + '\n';
      const cleanKey  = normalize(pems.private);
      const cleanCert = normalize(pems.cert);

      fs.writeFileSync(KEY_FILE,  cleanKey,  { encoding: 'utf8' });
      fs.writeFileSync(CERT_FILE, cleanCert, { encoding: 'utf8' });

      // Verify written files
      const k = fs.readFileSync(KEY_FILE,  'utf8');
      const c = fs.readFileSync(CERT_FILE, 'utf8');
      if (!k.includes('BEGIN') || !c.includes('BEGIN')) {
        throw new Error('PEM файлы записаны некорректно');
      }

      console.log('[HTTPS] ✓ Сертификат создан через selfsigned');
      return true;
    } catch(e) {
      console.error('[HTTPS] selfsigned ошибка:', e.message);
    }
  }

  // ── Strategy 3: Node.js built-in crypto (Node 18+) ─────────────────────────
  try {
    const { generateKeyPairSync, createSign } = require('crypto');
    console.log('[HTTPS] Попытка через Node.js crypto...');

    // Node.js 18+ has X509Certificate but not cert generation
    // Fall through to HTTP mode
    throw new Error('Node.js crypto не поддерживает генерацию X.509 напрямую');
  } catch(e) {
    // Expected
  }

  console.warn('[HTTPS] ⚠ Не удалось создать сертификат — сервер запустится по HTTP');
  console.warn('[HTTPS] Установите Git for Windows (содержит openssl) и перезапустите');
  return false;
}


// ── Auth config ──────────────────────────────────────────────────────────────
// Legacy single-password support: if PROCURE_PASSWORD set and no users in DB,
// it acts as the admin password (backward compatible).
const LEGACY_PASSWORD = process.env.PROCURE_PASSWORD || '';
const AUTH_ENABLED    = true; // always true — viewer role = no password

function generateToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

// ── User helpers ──────────────────────────────────────────────────────────────
function hashPassword(pw) {
  // PBKDF2-SHA256, 100k iterations — much stronger than plain SHA-256
  const { pbkdf2Sync } = require('crypto');
  return pbkdf2Sync(pw, 'procure-it-pbkdf2-salt-v1', 100000, 32, 'sha256').toString('hex');
}

// Migration: rehash old SHA-256 passwords to PBKDF2 on next login
function hashPasswordLegacy(pw) {
  return require('crypto').createHash('sha256').update(pw + 'procure-it-salt').digest('hex');
}

function getUsers() {
  try {
    const rows = db.exec('SELECT id, username, role, must_change_password FROM users ORDER BY id');
    return rows[0] ? rows[0].values.map(([id, username, role, mcp]) => ({ id, username, role, mustChangePassword: !!mcp })) : [];
  } catch(e) { return []; }
}

function findUserByCredentials(username, password) {
  try {
    const hash       = hashPassword(password);
    const legacyHash = hashPasswordLegacy(password);
    // Try PBKDF2 first
    let rows = db.exec('SELECT id, username, role, must_change_password FROM users WHERE username=? AND password=?', [username, hash]);
    if (!rows[0]?.values?.length) {
      // Try legacy SHA-256 — migrate on the fly
      rows = db.exec('SELECT id, username, role, must_change_password FROM users WHERE username=? AND password=?', [username, legacyHash]);
      if (rows[0]?.values?.length) {
        const [id] = rows[0].values[0];
        // Upgrade to PBKDF2
        db.run('UPDATE users SET password=? WHERE id=?', [hash, id]);
        saveDb();
        console.log(`[users] Upgraded password hash for user id=${id} to PBKDF2`);
      }
    }
    if (rows[0]?.values?.length) {
      const [id, uname, role, mcp] = rows[0].values[0];
      return { id, username: uname, role, mustChangePassword: !!mcp };
    }
    // Legacy fallback: if no users in DB, accept LEGACY_PASSWORD as admin
    const userCount = db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] || 0;
    if (userCount === 0 && LEGACY_PASSWORD && password === LEGACY_PASSWORD) {
      return { id: 0, username: 'admin', role: 'admin', mustChangePassword: false };
    }
    return null;
  } catch(e) { return null; }
}

// ── Session helpers ───────────────────────────────────────────────────────────
function sessionCreate(token, userId) {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
  try {
    db.run('INSERT OR REPLACE INTO sessions (token, expires_at, user_id) VALUES (?,?,?)', [token, expiresAt, userId || 0]);
    saveDb();
  } catch(e) { console.error('[sessions] create error:', e.message); }
}

function sessionDelete(token) {
  try { db.run('DELETE FROM sessions WHERE token = ?', [token]); saveDb(); } catch(e) {}
}

function sessionGetUser(token) {
  try {
    const rows = db.exec('SELECT expires_at, user_id FROM sessions WHERE token = ?', [token]);
    if (!rows.length || !rows[0].values.length) return null;
    const [expiresAt, userId] = rows[0].values[0];
    if (Date.now() > expiresAt) { sessionDelete(token); return null; }
    if (!userId) {
      // Legacy session (pre-multi-user) — only grant admin if no users table exists yet
      const userCount = (() => { try { return db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] || 0; } catch(e) { return 0; } })();
      if (userCount === 0) return { id: 0, username: 'admin', role: 'admin', mustChangePassword: false };
      return null; // legacy session invalid once users table is populated
    }
    const urows = db.exec('SELECT id, username, role, must_change_password FROM users WHERE id=?', [userId]);
    if (!urows[0]?.values?.length) return null;
    const [id, username, role, mcp] = urows[0].values[0];
    return { id, username, role, mustChangePassword: !!mcp };
  } catch(e) { return null; }
}

function getRequestRole(req) {
  // viewer: no token needed — read-only access
  const token = req.headers['x-auth-token'] || (req.cookies && req.cookies['auth-token']);
  if (!token) return 'viewer';
  return sessionGetUser(token)?.role || 'viewer';
}

function isAuthenticated(req) { return true; } // viewer always gets in

// Role-based middleware factories
function authMiddleware(req, res, next) {
  // All authenticated roles (operator, admin) + viewer for GET
  const role = getRequestRole(req);
  req.userRole = role;
  req.username = token => sessionGetUser(token)?.username || 'viewer';
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const token = req.headers['x-auth-token'] || (req.cookies && req.cookies['auth-token']);
    const user  = token ? sessionGetUser(token) : null;
    const role  = user?.role || 'viewer';
    req.userRole = role;

    // Block all write operations if password change is required
    if (user?.mustChangePassword && req.method !== 'GET') {
      // Allow only the change-password endpoint itself
      if (!req.path.includes('/auth/change-password')) {
        return res.status(403).json({ error: 'Смените временный пароль перед началом работы', mustChangePassword: true });
      }
    }

    if (roles.includes(role)) return next();
    res.status(403).json({ error: `Доступ запрещён. Требуется роль: ${roles.join(' или ')}` });
  };
}

const operatorOrAdmin = requireRole('operator', 'admin');
const adminOnly       = requireRole('admin');

// ── Middleware ────────────────────────────────────────────────────────────────
// Compression (gzip)
app.use(compression());

// Cookie parser (optional — for cookie-based auth)
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

// ── Auth endpoints ────────────────────────────────────────────────────────────
app.get('/api/auth/status', (req, res) => {
  const token = req.headers['x-auth-token'] || (req.cookies && req.cookies['auth-token']);
  const user  = token ? sessionGetUser(token) : null;
  const users = getUsers();
  res.json({
    authEnabled:        true,
    authenticated:      !!user,
    role:               user?.role || 'viewer',
    username:           user?.username || null,
    mustChangePassword: user?.mustChangePassword || false,
    hasUsers:           users.length > 0 || !!LEGACY_PASSWORD,
    viewerAllowed:      true,
  });
});

app.post('/api/auth/login', strictLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  const user = findUserByCredentials(username, password);
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = generateToken();
  sessionCreate(token, user.id);
  res.json({ ok: true, token, role: user.role, username: user.username, mustChangePassword: user.mustChangePassword });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) sessionDelete(token);
  res.json({ ok: true });
});

// ── DB ────────────────────────────────────────────────────────────────────────
let SQL, db;

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

  db.run(`PRAGMA journal_mode=WAL`);
  db.run(`PRAGMA foreign_keys=ON`);

  // Migrations — add new columns to existing DBs
  const migrations = [
    `ALTER TABLE requests ADD COLUMN invoice_num TEXT DEFAULT ''`,
    `ALTER TABLE requests ADD COLUMN signed_spec_pdf TEXT DEFAULT ''`,  // base64 подписанной спецификации
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
    address TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS requests (
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
    role                 TEXT NOT NULL DEFAULT 'operator',
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT DEFAULT (datetime('now'))
  )`);
  // Migrations for existing DBs
  try { db.run(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`); } catch(e) {}

  // Seed default admin on first run (no users in DB, no LEGACY_PASSWORD in env)
  const userCount = (() => {
    try { return db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] || 0; } catch(e) { return 0; }
  })();
  if (userCount === 0 && !LEGACY_PASSWORD) {
    const defaultHash = hashPassword('admin0000');
    try {
      db.run('INSERT INTO users (username, password, role, must_change_password) VALUES (?,?,?,?)',
        ['admin', defaultHash, 'admin', 1]);
      console.log('[users] ✓ Default admin created — login: admin / password: admin0000');
      console.log('[users] ⚠ Change the password on first login!');
    } catch(e) { console.error('[users] seed error:', e.message); }
  }

  // Purge expired sessions left over from previous runs
  db.run(`DELETE FROM sessions WHERE expires_at < ?`, [Date.now()]);

  // Orgs are created by the user — no seed data
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function rowToRequest(row) {
  if (!row) return null;
  return {
    id: row.id, specNum: row.spec_num, orgId: row.org_id,
    orgFull: row.org_full, orgShort: row.org_short, orgSignatory: row.org_signatory,
    // PDF stored as filename on disk — return sentinel or empty, never the raw blob
    signedSpecPdf: row.signed_spec_pdf ? '__has_pdf__' : '',
    bitrix: row.bitrix, name: row.name, mol: row.mol, date: row.date,
    address: row.address, supplier: row.supplier, invoiceNum: row.invoice_num, contract: row.contract,
    status: row.status, comment: row.comment,
    isRealization: !!row.is_realization,
    deliveryCost: row.delivery_cost, markup: row.markup,
    totalPurchase: row.total_purchase, total: row.total,
    positions: JSON.parse(row.positions || '[]'),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// ── Audit helper ─────────────────────────────────────────────────────────────
function auditLog(action, requestId, field, oldValue, newValue, meta) {
  try {
    run(
      `INSERT INTO audit_log (action, request_id, field, old_value, new_value, meta)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [action, requestId || null, field || null,
       oldValue !== undefined ? String(oldValue) : null,
       newValue !== undefined ? String(newValue) : null,
       meta ? JSON.stringify(meta) : null]
    );
  } catch(e) { console.error('[AUDIT]', e.message); }
}

// ── ORGS ──────────────────────────────────────────────────────────────────────
app.get('/api/orgs', (req, res) => {
  res.json(query('SELECT * FROM orgs ORDER BY short'));
});

app.post('/api/orgs', operatorOrAdmin, (req, res) => {
  const { full, short, prefix, signatory='', contract='', address='' } = req.body;
  if (!full || !short || !prefix) return res.status(400).json({ error: 'Обязательные поля: full, short, prefix' });
  const id = Date.now().toString();
  run('INSERT INTO orgs (id,full,short,prefix,signatory,contract,address) VALUES (?,?,?,?,?,?,?)',
    [id, full, short, prefix, signatory, contract, address]);
  res.json(query('SELECT * FROM orgs WHERE id=?', [id])[0]);
});

app.put('/api/orgs/:id', operatorOrAdmin, (req, res) => {
  const { full, short, prefix, signatory='', contract='', address='' } = req.body;
  if (!full || !short || !prefix) return res.status(400).json({ error: 'Обязательные поля: full, short, prefix' });
  const exists = query('SELECT id FROM orgs WHERE id=?', [req.params.id])[0];
  if (!exists) return res.status(404).json({ error: 'Организация не найдена' });
  run('UPDATE orgs SET full=?,short=?,prefix=?,signatory=?,contract=?,address=? WHERE id=?',
    [full, short, prefix, signatory, contract, address, req.params.id]);
  res.json(query('SELECT * FROM orgs WHERE id=?', [req.params.id])[0]);
});

app.delete('/api/orgs/:id', operatorOrAdmin, (req, res) => {
  const used = query('SELECT COUNT(*) as c FROM requests WHERE org_id=?', [req.params.id]);
  if ((used[0]?.c || 0) > 0) return res.status(400).json({ error: 'Нельзя удалить — есть заявки' });
  run('DELETE FROM orgs WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ── REQUESTS ──────────────────────────────────────────────────────────────────
app.get('/api/requests', (req, res) => {
  let sql = 'SELECT * FROM requests WHERE 1=1';
  const params = [];
  if (req.query.org)    { sql += ' AND org_id=?';    params.push(req.query.org); }
  if (req.query.month)  { sql += ' AND date LIKE ?';  params.push(req.query.month + '%'); }
  if (req.query.status)   { sql += ' AND status=?';     params.push(req.query.status); }
  if (req.query.supplier) { sql += ' AND supplier=?'; params.push(req.query.supplier); }
  if (req.query.q) {
    sql += ' AND (name LIKE ? OR mol LIKE ? OR spec_num LIKE ? OR bitrix LIKE ? OR positions LIKE ?)';
    const q = '%' + req.query.q + '%';
    params.push(q, q, q, q, q);
  }
  sql += ' ORDER BY created_at DESC';

  // Server-side pagination — default 100 per page, max 500
  const limit  = Math.min(parseInt(req.query.limit  || '100'), 500);
  const offset = Math.max(parseInt(req.query.offset || '0'),   0);

  // Count total matching rows for pagination metadata
  const countSql = sql
    .replace(/^SELECT \*/, 'SELECT COUNT(*) as total')
    .replace(/ ORDER BY .+$/, '');
  const total = query(countSql, params)[0]?.total || 0;

  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  res.json({
    items:  query(sql, params).map(rowToRequest),
    total,
    limit,
    offset,
  });
});

app.get('/api/requests/:id', (req, res) => {
  const row = query('SELECT * FROM requests WHERE id=?', [req.params.id])[0];
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  res.json(rowToRequest(row)); // PDF served via /api/requests/:id/signed-spec
});

app.post('/api/requests', operatorOrAdmin, (req, res) => {
  const r = req.body;
  if (!r.name) return res.status(400).json({ error: 'Название обязательно' });
  // Validate positions
  if (r.positions && !Array.isArray(r.positions)) {
    return res.status(400).json({ error: 'positions должен быть массивом' });
  }
  if (r.positions) {
    for (const p of r.positions) {
      if (typeof p.name !== 'string') return res.status(400).json({ error: 'Некорректная позиция: name' });
      if (p.qty !== undefined && (isNaN(p.qty) || p.qty < 0)) return res.status(400).json({ error: 'Некорректное кол-во' });
      if (p.purchasePrice !== undefined && isNaN(p.purchasePrice)) return res.status(400).json({ error: 'Некорректная цена' });
    }
  }
  const id = r.id || Date.now().toString();
  const ALLOWED_STATUSES = ['new','ordered','partial','delivered','cancelled'];
  if (r.status && !ALLOWED_STATUSES.includes(r.status)) r.status = 'new';
  run(`INSERT INTO requests (id,spec_num,org_id,org_full,org_short,org_signatory,bitrix,name,mol,date,address,supplier,invoice_num,contract,status,comment,is_realization,delivery_cost,markup,total_purchase,total,positions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'',
     r.bitrix||'', r.name, r.mol||'', r.date||'', r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
     r.status||'new', r.comment||'', r.isRealization?1:0,
     r.deliveryCost||0, r.markup||5, r.totalPurchase||0, r.total||0,
     JSON.stringify(r.positions||[])]);
  auditLog('CREATE', id, null, null, r.specNum, { name: r.name, org: r.orgShort });
  res.json(rowToRequest(query('SELECT * FROM requests WHERE id=?', [id])[0]));
});

app.put('/api/requests/:id', operatorOrAdmin, (req, res) => {
  const r = req.body;
  if (!r.name) return res.status(400).json({ error: 'Название обязательно' });
  if (r.positions && !Array.isArray(r.positions)) return res.status(400).json({ error: 'positions должен быть массивом' });
  const ALLOWED_STATUSES = ['new','ordered','partial','delivered','cancelled'];
  if (r.status && !ALLOWED_STATUSES.includes(r.status)) r.status = 'new';
  // Compute field-level diff against current state
  const prev = query('SELECT * FROM requests WHERE id=?', [req.params.id])[0];
  if (!prev) return res.status(404).json({ error: 'Заявка не найдена' });
  const diffFields = [];
  if (prev) {
    const fieldMap = {
      name:          [prev.name,          r.name],
      mol:           [prev.mol,           r.mol],
      date:          [prev.date,          r.date],
      address:       [prev.address,       r.address],
      supplier:      [prev.supplier,      r.supplier],
      contract:      [prev.contract,      r.contract],
      invoice_num:   [prev.invoice_num,   r.invoiceNum],
      delivery_cost: [prev.delivery_cost, r.deliveryCost],
      markup:        [prev.markup,        r.markup],
      comment:       [prev.comment,       r.comment],
    };
    for (const [field, [oldV, newV]] of Object.entries(fieldMap)) {
      const o = String(oldV ?? ''), n = String(newV ?? '');
      if (o !== n) diffFields.push({ field, old: o, new: n });
    }
    // Positions diff — detailed: added, removed, changed items
    const prevPos = JSON.parse(prev.positions || '[]');
    const newPos  = r.positions || [];

    const prevNames = new Set(prevPos.map(p => p.name));
    const newNames  = new Set(newPos.map(p => p.name));

    const added   = newPos.filter(p => !prevNames.has(p.name)).map(p => p.name);
    const removed = prevPos.filter(p => !newNames.has(p.name)).map(p => p.name);

    // Changed: same name but different qty or price
    const changed = [];
    for (const np of newPos) {
      const pp = prevPos.find(p => p.name === np.name);
      if (!pp) continue;
      const changes = [];
      if (String(pp.qty) !== String(np.qty))
        changes.push(`кол-во: ${pp.qty}→${np.qty}`);
      if (String(pp.purchasePrice) !== String(np.purchasePrice))
        changes.push(`цена: ${pp.purchasePrice}→${np.purchasePrice}`);
      if (changes.length) changed.push(`${np.name} (${changes.join(', ')})`);
    }

    if (added.length)   diffFields.push({ field: 'positions_added',   old: '', new: added.join('; ') });
    if (removed.length) diffFields.push({ field: 'positions_removed', old: removed.join('; '), new: '' });
    if (changed.length) diffFields.push({ field: 'positions_changed', old: '', new: changed.join('; ') });
    if (prevPos.length !== newPos.length) {
      diffFields.push({ field: 'positions_count', old: String(prevPos.length), new: String(newPos.length) });
    }
    if (String(prev.total) !== String(r.total || 0)) {
      diffFields.push({ field: 'total', old: String(prev.total), new: String(r.total || 0) });
    }
  }

  run(`UPDATE requests SET spec_num=?,org_id=?,org_full=?,org_short=?,org_signatory=?,bitrix=?,name=?,mol=?,date=?,address=?,supplier=?,invoice_num=?,contract=?,status=?,comment=?,is_realization=?,delivery_cost=?,markup=?,total_purchase=?,total=?,positions=?,updated_at=datetime('now') WHERE id=?`,
    [r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'',
     r.bitrix||'', r.name, r.mol||'', r.date||'', r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
     r.status||'new', r.comment||'', r.isRealization?1:0,
     r.deliveryCost||0, r.markup||5, r.totalPurchase||0, r.total||0,
     JSON.stringify(r.positions||[]), req.params.id]);
  auditLog('UPDATE', req.params.id, 'request', null, r.specNum, { name: r.name, diff: diffFields });
  res.json(rowToRequest(query('SELECT * FROM requests WHERE id=?', [req.params.id])[0]));
});

app.patch('/api/requests/:id/status', operatorOrAdmin, (req, res) => {
  const { status } = req.body;
  const ALLOWED = ['new','ordered','partial','delivered','cancelled'];
  if (!status || !ALLOWED.includes(status)) {
    return res.status(400).json({ error: `Недопустимый статус. Допустимые: ${ALLOWED.join(', ')}` });
  }
  const old = query('SELECT status, spec_num, name, org_short, total FROM requests WHERE id=?', [req.params.id])[0];
  if (!old) return res.status(404).json({ error: 'Заявка не найдена' });
  run("UPDATE requests SET status=?,updated_at=datetime('now') WHERE id=?", [status, req.params.id]);
  auditLog('STATUS', req.params.id, 'status', old.status, status, { specNum: old.spec_num });

  // Fire status webhook asynchronously — don't block response
  (async () => {
    try {
      const whRows = db.exec("SELECT value FROM settings WHERE key='statusWebhook'");
      const webhookUrl = whRows[0]?.values?.[0]?.[0] || '';
      if (!webhookUrl) return;
      const payload = {
        event:    'status_changed',
        specNum:  old.spec_num,
        name:     old.name,
        org:      old.org_short,
        total:    old.total,
        oldStatus: old.status,
        newStatus: status,
        changedAt: new Date().toISOString(),
      };
      const https = require('https');
      const http  = require('http');
      const body  = JSON.stringify(payload);
      const parsed = new URL(webhookUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      await new Promise((resolve, reject) => {
        const r2 = lib.request({
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res2 => { res2.resume(); res2.on('end', resolve); });
        r2.on('error', reject);
        r2.write(body);
        r2.end();
      });
    } catch(e) { console.warn('[statusWebhook]', e.message); }
  })();

  res.json({ ok: true });
});

app.delete('/api/requests/:id', operatorOrAdmin, (req, res) => {
  const old = query('SELECT spec_num, name FROM requests WHERE id=?', [req.params.id])[0];
  if (!old) return res.status(404).json({ error: 'Заявка не найдена' });
  run('DELETE FROM requests WHERE id=?', [req.params.id]);
  auditLog('DELETE', req.params.id, null, old.spec_num, null, { name: old.name });
  res.json({ ok: true });
});

// ── ADDRESSES ─────────────────────────────────────────────────────────────────
app.get('/api/mol', operatorOrAdmin, (req, res) => {
  const rows = query(`SELECT DISTINCT mol FROM requests WHERE mol != '' ORDER BY mol LIMIT 50`);
  res.json(rows.map(r => r.mol));
});


app.get('/api/addresses', operatorOrAdmin, (req, res) => {
  res.json(query('SELECT address FROM addresses ORDER BY used_at DESC LIMIT 30').map(r => r.address));
});

app.post('/api/addresses', operatorOrAdmin, (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  run(`INSERT INTO addresses (address, used_at) VALUES (?, datetime('now'))
       ON CONFLICT(address) DO UPDATE SET used_at=datetime('now')`, [address]);
  res.json({ ok: true });
});

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
app.get('/api/templates', operatorOrAdmin, (req, res) => {
  res.json(query('SELECT * FROM templates ORDER BY created_at DESC')
    .map(r => ({ ...r, positions: JSON.parse(r.positions || '[]') })));
});

app.post('/api/templates', operatorOrAdmin, (req, res) => {
  const { name, positions=[] } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.run('INSERT INTO templates (name, positions) VALUES (?,?)', [name, JSON.stringify(positions)]);
  saveDb();
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  res.json({ id, name, positions });
});

app.delete('/api/templates/:id', operatorOrAdmin, (req, res) => {
  run('DELETE FROM templates WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ── Users API (admin only) ────────────────────────────────────────────────────
app.get('/api/users', adminOnly, (req, res) => {
  res.json(getUsers());
});

app.post('/api/users', adminOnly, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  const ROLES = ['viewer', 'operator', 'admin'];
  if (!ROLES.includes(role)) return res.status(400).json({ error: `Роль должна быть: ${ROLES.join(', ')}` });
  try {
    const hash = hashPassword(password);
    run('INSERT INTO users (username, password, role) VALUES (?,?,?)', [username, hash, role]);
    saveDb();
    res.json({ ok: true });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Пользователь уже существует' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/users/:id', adminOnly, (req, res) => {
  const { password, role } = req.body;
  const ROLES = ['viewer', 'operator', 'admin'];
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: `Недопустимая роль` });

  // Prevent self-demotion
  const token    = req.headers['x-auth-token'];
  const self     = token ? sessionGetUser(token) : null;
  if (self && String(self.id) === String(req.params.id) && role && role !== 'admin') {
    return res.status(400).json({ error: 'Нельзя понизить собственную роль' });
  }

  if (password) {
    const hash = hashPassword(password);
    run('UPDATE users SET password=?, must_change_password=0 WHERE id=?', [hash, req.params.id]);
  }
  if (role) run('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
  saveDb();
  res.json({ ok: true });
});

// Self-service password change (any authenticated user, for their own account)
app.post('/api/auth/change-password', strictLimiter, (req, res) => {
  const token = req.headers['x-auth-token'];
  const user  = token ? sessionGetUser(token) : null;
  if (!user || !user.id) return res.status(401).json({ error: 'Не авторизован' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Укажите текущий и новый пароль' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Новый пароль должен быть минимум 6 символов' });
  // Verify current password
  const currentHash = hashPassword(currentPassword);
  const check = db.exec('SELECT id FROM users WHERE id=? AND password=?', [user.id, currentHash]);
  if (!check[0]?.values?.length) return res.status(401).json({ error: 'Текущий пароль неверен' });
  run('UPDATE users SET password=?, must_change_password=0 WHERE id=?', [hashPassword(newPassword), user.id]);
  saveDb();
  res.json({ ok: true });
});

app.delete('/api/users/:id', adminOnly, (req, res) => {
  const users = getUsers();
  const admins = users.filter(u => u.role === 'admin');
  const target = users.find(u => u.id == req.params.id);
  if (target?.role === 'admin' && admins.length <= 1) {
    return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
  }
  run('DELETE FROM users WHERE id=?', [req.params.id]);
  run('DELETE FROM sessions WHERE user_id=?', [req.params.id]);
  saveDb();
  res.json({ ok: true });
});

// ── STATS ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const total    = query('SELECT COUNT(*) as c, SUM(total) as s, SUM(total_purchase) as p FROM requests')[0] || {};
  const thisMonth = new Date().toISOString().slice(0,7);
  const month    = query("SELECT COUNT(*) as c FROM requests WHERE date LIKE ?", [thisMonth+'%'])[0] || {};
  const byOrg    = query(`SELECT org_short, COUNT(*) as count, SUM(total) as sell, SUM(total_purchase) as purchase, SUM(delivery_cost) as delivery FROM requests GROUP BY org_id ORDER BY sell DESC`);
  res.json({
    totalRequests: total.c || 0,
    totalSell:     total.s || 0,
    totalPurchase: total.p || 0,
    thisMonth:     month.c || 0,
    byOrg,
  });
});

// ── BACKUP / RESTORE ──────────────────────────────────────────────────────────
app.get('/api/backup', adminOnly, (req, res) => {
  const orgs      = query('SELECT * FROM orgs');
  const requests  = query('SELECT * FROM requests').map(rowToRequest);
  const addresses = query('SELECT address FROM addresses').map(r => r.address);
  const templates = query('SELECT * FROM templates').map(r => ({ ...r, positions: JSON.parse(r.positions||'[]') }));
  const date = new Date().toISOString().slice(0,10);
  const auditRows = query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1000');
  const settingsRows = query('SELECT key, value FROM settings');
  // Exclude networkPass from backup — it's a credential, not config data
  const settings = Object.fromEntries(
    settingsRows.filter(r => r.key !== 'networkPass').map(r => [r.key, r.value])
  );
  // Include users (with hashed passwords) so restore preserves auth
  const users = query('SELECT id, username, password, role, must_change_password, created_at FROM users');
  res.setHeader('Content-Disposition', `attachment; filename="zakupki_backup_${date}.json"`);
  res.json({ version: 3, exported: new Date().toISOString(), orgs, requests, addresses, templates, settings, audit: auditRows, users });
});

app.post('/api/restore', adminOnly, strictLimiter, (req, res) => {
  const { orgs=[], requests=[], addresses=[], templates=[] } = req.body;
  try {
    if (orgs.length) {
      run('DELETE FROM orgs');
      for (const o of orgs) {
        run('INSERT OR REPLACE INTO orgs (id,full,short,prefix,signatory,contract,address) VALUES (?,?,?,?,?,?,?)',
          [o.id, o.full, o.short, o.prefix, o.signatory||'', o.contract||'', o.address||'']);
      }
    }
    if (requests.length) {
      run('DELETE FROM requests');
      for (const r of requests) {
        run(`INSERT OR REPLACE INTO requests (id,spec_num,org_id,org_full,org_short,org_signatory,bitrix,name,mol,date,address,supplier,invoice_num,contract,status,comment,is_realization,delivery_cost,markup,total_purchase,total,positions,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.id, r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'',
           r.bitrix||'', r.name, r.mol||'', r.date||'', r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
           r.status||'new', r.comment||'', r.isRealization?1:0,
           r.deliveryCost||0, r.markup||5, r.totalPurchase||0, r.total||0,
           JSON.stringify(r.positions||[]), r.createdAt||new Date().toISOString()]);
      }
    }
    for (const a of addresses) {
      run('INSERT OR IGNORE INTO addresses (address) VALUES (?)', [a]);
    }
    if (templates.length) {
      run('DELETE FROM templates');
      for (const t of templates) {
        run('INSERT INTO templates (name,positions) VALUES (?,?)', [t.name, JSON.stringify(t.positions||[])]);
      }
    }
    // Restore settings
    if (req.body.settings && typeof req.body.settings === 'object') {
      const allowed = Object.keys(DEFAULT_SETTINGS);
      for (const [k, v] of Object.entries(req.body.settings)) {
        if (allowed.includes(k)) run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [k, String(v)]);
      }
    }
    // Restore users (preserve passwords as-is — already hashed)
    if (req.body.users && Array.isArray(req.body.users) && req.body.users.length) {
      run('DELETE FROM users');
      for (const u of req.body.users) {
        if (!u.username || !u.password || !u.role) continue;
        run('INSERT OR REPLACE INTO users (id,username,password,role,must_change_password,created_at) VALUES (?,?,?,?,?,?)',
          [u.id||null, u.username, u.password, u.role, u.must_change_password||0, u.created_at||new Date().toISOString()]);
      }
    }
    saveDb();
    // Invalidate all sessions after restore — DB state changed, force re-login
    try { db.run('DELETE FROM sessions'); } catch(e) {}
    res.json({ ok: true, restored: { orgs: orgs.length, requests: requests.length } });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Audit log API ────────────────────────────────────────────────────────────
app.get('/api/audit', operatorOrAdmin, (req, res) => {
  const { request_id, limit = 50 } = req.query;
  let sql = 'SELECT * FROM audit_log';
  const params = [];
  if (request_id) { sql += ' WHERE request_id = ?'; params.push(request_id); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(parseInt(limit) || 50);
  res.json(query(sql, params));
});

// ── Settings API ─────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  appName:        'Закупки ИТ',
  appSubtitle:    'Управление заявками',
  logoBase64:     '',
  accentLight:    '#2563eb',
  accentDark:     '#60a5fa',
  successLight:   '#16a34a',
  successDark:    '#4ade80',
  bitrixWebhook:  '',   // URL вида https://your.bitrix24.ru/rest/1/key/
  statusWebhook:  '',   // POST JSON при смене статуса заявки
  networkFolder:  '',   // Путь к сетевой папке, напр. \\\\server\\share или /mnt/share
  networkUser:    '',   // Логин для сетевой папки (Windows: домен\\пользователь)
  networkPass:    '',   // Пароль для сетевой папки
};

app.get('/api/settings', adminOnly, (req, res) => {
  try {
    const rows = db.exec('SELECT key, value FROM settings');
    const result = { ...DEFAULT_SETTINGS };
    if (rows.length && rows[0].values) {
      rows[0].values.forEach(([k, v]) => { if (k in result) result[k] = v; });
    }
    // Never expose the actual password over the wire — return a sentinel so
    // the UI knows a password is set without leaking it
    if (result.networkPass) result.networkPass = '••••••••';
    res.json(result);
  } catch(e) { res.json({ ...DEFAULT_SETTINGS }); }
});

app.put('/api/settings', adminOnly, (req, res) => {
  try {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    // Validate logo size (max 500KB base64)
    if (req.body.logoBase64 && req.body.logoBase64.length > 700000) {
      return res.status(400).json({ error: 'Логотип слишком большой. Максимум 500KB.' });
    }
    // Validate logo format
    if (req.body.logoBase64 && req.body.logoBase64.length > 0) {
      const validFormats = ['data:image/svg', 'data:image/png', 'data:image/jpeg', 'data:image/webp'];
      if (!validFormats.some(f => req.body.logoBase64.startsWith(f))) {
        return res.status(400).json({ error: 'Недопустимый формат логотипа. SVG, PNG, JPG, WebP.' });
      }
    }
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) {
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, String(v)]);
      }
    }
    saveDb();
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Автобэкап ────────────────────────────────────────────────────────────────
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function doBackup() {
  try {
    const data = db.export();
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toTimeString().slice(0, 5).replace(':', '-');
    const fname = `zakupki_${date}_${time}.db`;
    const fpath = path.join(BACKUP_DIR, fname);
    fs.writeFileSync(fpath, Buffer.from(data));

    // Удаляем бэкапы старше 30 дней
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
      .sort((a, b) => b.time - a.time);

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    files.forEach(f => {
      if (f.time < cutoff) {
        fs.unlinkSync(path.join(BACKUP_DIR, f.name));
        console.log('[BACKUP] Удалён старый бэкап:', f.name);
      }
    });

    console.log(`[BACKUP] ✓ ${fname} (${(data.byteLength / 1024).toFixed(1)} KB)`);
  } catch(e) {
    console.error('[BACKUP] Ошибка:', e.message);
  }
}

// Первый бэкап через 10с после старта
setTimeout(doBackup, 10000);

// Бэкап каждые 6 часов
const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL_MS || String(6 * 60 * 60 * 1000));
setInterval(doBackup, BACKUP_INTERVAL);

// Очистка истёкших сессий каждый час
setInterval(() => {
  try {
    db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
    saveDb();
  } catch(e) { console.error('[sessions] cleanup error:', e.message); }
}, 60 * 60 * 1000);

// Эндпоинт для ручного бэкапа БД (бинарный .db файл)
app.get('/api/backup/db', adminOnly, strictLimiter, (req, res) => {
  try {
    doBackup();
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse();
    if (files.length === 0) return res.status(500).json({ error: 'Нет бэкапов' });
    const latest = path.join(BACKUP_DIR, files[0]);
    res.download(latest, files[0]);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SPEC DOCX ─────────────────────────────────────────────────────────────────
app.post('/api/spec-docx', operatorOrAdmin, (req, res) => {
  try {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
            WidthType, AlignmentType, BorderStyle, VerticalAlign,
            ShadingType, HeadingLevel } = require('docx');

    const r = req.body;
    const total = r.total || 0;
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

    function fmtRub(n) {
      return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function numToWords(n) {
      const r2 = Math.floor(n);
      const k = Math.round((n - r2) * 100);
      const ones   = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
      const ones_f = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
      const teens  = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
      const tens   = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
      const hundreds=['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
      function chunk(num, female) {
        let s = ''; const h = Math.floor(num/100); num %= 100;
        s += hundreds[h] ? hundreds[h]+' ' : '';
        if (num >= 10 && num < 20) { s += teens[num-10]+' '; }
        else {
          s += tens[Math.floor(num/10)] ? tens[Math.floor(num/10)]+' ' : '';
          num %= 10;
          s += (female ? ones_f[num] : ones[num]) ? (female ? ones_f[num] : ones[num])+' ' : '';
        }
        return s;
      }
      function rubWord(n) { const n2=n%100,n1=n%10; if(n2>=11&&n2<=19) return 'рублей'; if(n1===1) return 'рубль'; if(n1>=2&&n1<=4) return 'рубля'; return 'рублей'; }
      function kopWord(n) { const n2=n%100,n1=n%10; if(n2>=11&&n2<=19) return 'копеек'; if(n1===1) return 'копейка'; if(n1>=2&&n1<=4) return 'копейки'; return 'копеек'; }
      let result = '';
      const millions = Math.floor(r2/1000000), thousands = Math.floor((r2%1000000)/1000), rubs = r2%1000;
      if (millions) { result += chunk(millions,false); const m2=millions%100,m1=millions%10; if(m2>=11&&m2<=19) result+='миллионов '; else if(m1===1) result+='миллион '; else if(m1>=2&&m1<=4) result+='миллиона '; else result+='миллионов '; }
      if (thousands) { result += chunk(thousands,true); const t2=thousands%100,t1=thousands%10; if(t2>=11&&t2<=19) result+='тысяч '; else if(t1===1) result+='тысяча '; else if(t1>=2&&t1<=4) result+='тысячи '; else result+='тысяч '; }
      if (rubs || !result) result += chunk(rubs,false);
      result = result.trim(); if (!result) result = 'ноль';
      result = result.charAt(0).toUpperCase()+result.slice(1);
      result += ' '+rubWord(r2);
      let kopStr = k === 0 ? 'ноль' : (chunk(k,true).trim()||'ноль');
      kopStr = kopStr.charAt(0).toUpperCase()+kopStr.slice(1);
      result += ' '+kopStr+' '+kopWord(k);
      return result;
    }

    const dateObj = new Date(r.date || Date.now());
    const dateStr = `«${String(dateObj.getDate()).padStart(2,'0')}» ${months[dateObj.getMonth()]} ${dateObj.getFullYear()} г.`;

    const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
    const allBorders = { top: border, bottom: border, left: border, right: border };

    function cell(text, opts = {}) {
      return new TableCell({
        borders: allBorders,
        verticalAlign: VerticalAlign.CENTER,
        width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFFFF' },
        children: [new Paragraph({
          alignment: opts.align || AlignmentType.LEFT,
          children: [new TextRun({ text: String(text||''), size: 22, font: 'Times New Roman', bold: !!opts.bold })]
        })]
      });
    }

    // Table width in DXA (A4 minus margins: ~170mm = 9639 DXA)
    const TW = 9639;
    const colWidths = [545, 5449, 900, 1372, 1373]; // sum = 9639

    // Header row
    const headerRow = new TableRow({ tableHeader: true, children: [
      cell('№ п/п',   { width: colWidths[0], align: AlignmentType.CENTER, bold: true }),
      cell('Наименование Товара', { width: colWidths[1], bold: true }),
      cell('Кол-во (шт.)',        { width: colWidths[2], align: AlignmentType.CENTER, bold: true }),
      cell('Цена за ед., руб. (без НДС)', { width: colWidths[3], align: AlignmentType.CENTER, bold: true }),
      cell('Стоимость, руб. (без НДС)',   { width: colWidths[4], align: AlignmentType.CENTER, bold: true }),
    ]});

    const dataRows = (r.positions || []).map((p, i) => {
      const sellUnit = p.sellPerUnit || (p.purchasePrice||0)*(1+(r.markup||5)/100);
      const sellSum  = p.sellSum    || sellUnit * p.qty;
      return new TableRow({ children: [
        cell(i+1,               { width: colWidths[0], align: AlignmentType.CENTER }),
        cell(p.name||'',        { width: colWidths[1] }),
        cell(p.qty||1,          { width: colWidths[2], align: AlignmentType.CENTER }),
        cell(fmtRub(sellUnit),  { width: colWidths[3], align: AlignmentType.RIGHT }),
        cell(fmtRub(sellSum),   { width: colWidths[4], align: AlignmentType.RIGHT }),
      ]});
    });

    const itogRow = new TableRow({ children: [
      cell('', { width: colWidths[0] }),
      cell('', { width: colWidths[1] }),
      cell('', { width: colWidths[2] }),
      cell('Итого:', { width: colWidths[3], align: AlignmentType.RIGHT, bold: true }),
      cell(fmtRub(total), { width: colWidths[4], align: AlignmentType.RIGHT, bold: true }),
    ]});

    const ndsRow = new TableRow({ children: [
      new TableCell({ columnSpan: 5, borders: allBorders, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFFFF' },
        children: [new Paragraph({ children: [new TextRun({ text: 'НДС: не облагается', size: 22, font: 'Times New Roman' })] })] })
    ]});

    const specTable = new Table({
      width: { size: TW, type: WidthType.DXA },
      columnWidths: colWidths,
      rows: [headerRow, ...dataRows, itogRow, ndsRow]
    });

    function para(text, opts = {}) {
      return new Paragraph({
        alignment: opts.align || AlignmentType.LEFT,
        spacing: { before: opts.before || 120, after: opts.after || 0 },
        children: [new TextRun({
          text, size: opts.size || 22, font: 'Times New Roman',
          bold: !!opts.bold, italics: !!opts.italic
        })]
      });
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 1134, bottom: 1134, left: 1701, right: 850 }, // ~20mm/15mm/30mm/15mm
          }
        },
        children: [
          // Приложение ref (right-aligned)
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: `Приложение №1 к договору поставки № ${r.contract||'—'}`, size: 20, font: 'Times New Roman', color: '555555' })]
          }),
          // Заголовок
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
            children: [new TextRun({ text: `СПЕЦИФИКАЦИЯ № ${r.specNum||''}`, size: 26, bold: true, font: 'Times New Roman' })]
          }),
          // Город / дата
          new Table({
            width: { size: TW, type: WidthType.DXA },
            columnWidths: [TW/2, TW/2],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
            rows: [new TableRow({ children: [
              new TableCell({ borders: { top:{style:BorderStyle.NONE}, bottom:{style:BorderStyle.NONE}, left:{style:BorderStyle.NONE}, right:{style:BorderStyle.NONE} }, children: [new Paragraph({ children: [new TextRun({ text: 'г. Екатеринбург', size: 22, font: 'Times New Roman' })] })] }),
              new TableCell({ borders: { top:{style:BorderStyle.NONE}, bottom:{style:BorderStyle.NONE}, left:{style:BorderStyle.NONE}, right:{style:BorderStyle.NONE} }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: dateStr, size: 22, font: 'Times New Roman' })] })] }),
            ]})]
          }),
          new Paragraph({ spacing: { before: 160, after: 0 }, children: [] }),
          // Таблица
          specTable,
          // Текст
          para(`Всего наименований ${(r.positions||[]).length}, на сумму ${fmtRub(total)} рублей, без НДС`, { before: 180 }),
          new Paragraph({
            spacing: { before: 80, after: 0 },
            children: [new TextRun({ text: `${numToWords(total)}, НДС не облагается.`, size: 22, font: 'Times New Roman', italics: true })]
          }),
          para('Срок поставки Товара: 14 дней.', { before: 160 }),
          new Paragraph({ spacing: { before: 120, after: 0 }, children: [new TextRun({ text: 'Порядок оплаты:', size: 22, font: 'Times New Roman', bold: true })] }),
          para('— Аванс (предварительная оплата) в размере 100 % от стоимости Товара, подлежащего поставке по настоящей Спецификации. Цена указана с доставкой до Покупателя.', { before: 80 }),
          ...(r.address ? [para(`Адрес доставки/выборки: ${r.address}`, { before: 80 })] : []),
          para('Качество Товара должно соответствовать установленным требованиям государственных стандартов качества.', { before: 80 }),
          para('Настоящая Спецификация составлена в двух экземплярах, имеющих равную юридическую силу.', { before: 80 }),
          // Подписи — без рамок, ФИО из карточки организации
          new Paragraph({ spacing: { before: 400, after: 0 }, children: [] }),
          new Table({
            width: { size: TW, type: WidthType.DXA },
            columnWidths: [TW/2-200, 400, TW/2-200],
            borders: { top:{style:BorderStyle.NONE}, bottom:{style:BorderStyle.NONE}, left:{style:BorderStyle.NONE}, right:{style:BorderStyle.NONE}, insideH:{style:BorderStyle.NONE}, insideV:{style:BorderStyle.NONE} },
            rows: [
              // Строка 1: названия сторон
              new TableRow({ children: [
                new TableCell({ borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}}, children: [
                  new Paragraph({ children: [new TextRun({ text: `Поставщик: ${r.supplier||'___________'}`, size: 22, font: 'Times New Roman', bold: true })] }),
                ] }),
                new TableCell({ borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}}, children: [new Paragraph({children:[]})] }),
                new TableCell({ borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}}, children: [
                  new Paragraph({ children: [new TextRun({ text: `Покупатель: ${r.orgFull||'___________'}`, size: 22, font: 'Times New Roman', bold: true })] }),
                ] }),
              ]}),
              // Строка 2: отступ для подписи
              new TableRow({ children: [
                new TableCell({ borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}}, children: [new Paragraph({spacing:{before:480},children:[]})] }),
                new TableCell({ borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}}, children: [new Paragraph({children:[]})] }),
                new TableCell({ borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}}, children: [new Paragraph({spacing:{before:480},children:[]})] }),
              ]}),
              // Строка 3: подписи — только нижняя линия, без рамки вокруг
              new TableRow({ children: [
                new TableCell({
                  borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.SINGLE,size:6,color:'000000'},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}},
                  children: [new Paragraph({ children: [new TextRun({ text: 'подпись / Б.П.', size: 18, font: 'Times New Roman', color: '555555' })] })]
                }),
                new TableCell({ borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}}, children: [new Paragraph({children:[]})] }),
                new TableCell({
                  borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.SINGLE,size:6,color:'000000'},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}},
                  children: [new Paragraph({ children: [new TextRun({
                    text: `/Директор/ ${r.orgSignatory || 'М.П.'}`,
                    size: 18, font: 'Times New Roman', color: '555555'
                  })] })]
                }),
              ]}),
            ]
          }),
        ]
      }]
    });

    Packer.toBuffer(doc).then(buf => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent((r.specNum||'spec')+'_спецификация.docx')}`);
      res.send(buf);
    }).catch(e => res.status(500).json({ error: e.message }));
  } catch(e) {
    console.error('[spec-docx]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Signed spec PDF ───────────────────────────────────────────────────────────
// Upload: POST /api/requests/:id/signed-spec  { pdf: base64 }
app.post('/api/requests/:id/signed-spec', operatorOrAdmin, express.json({ limit: '20mb' }), (req, res) => {
  try {
    const { pdf } = req.body;
    if (!pdf || !pdf.startsWith('data:application/pdf')) {
      return res.status(400).json({ error: 'Ожидается PDF в формате base64' });
    }
    const row = query('SELECT spec_num FROM requests WHERE id=?', [req.params.id])[0];
    if (!row) return res.status(404).json({ error: 'Заявка не найдена' });

    // Save PDF to disk — avoids bloating SQLite with binary data
    const fname = `${req.params.id}.pdf`;
    const fpath = path.join(SIGNED_DIR, fname);
    const buf   = Buffer.from(pdf.replace(/^data:application\/pdf;base64,/, ''), 'base64');
    fs.writeFileSync(fpath, buf);

    // Store only the filename in DB (not the full base64)
    run("UPDATE requests SET signed_spec_pdf=? WHERE id=?", [fname, req.params.id]);
    saveDb();
    auditLog('UPDATE', req.params.id, 'signed_spec', '', 'uploaded', { name: 'подписанная спецификация' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Download: GET /api/requests/:id/signed-spec
app.get('/api/requests/:id/signed-spec', operatorOrAdmin, (req, res) => {
  try {
    const row = query('SELECT signed_spec_pdf, spec_num FROM requests WHERE id=?', [req.params.id])[0];
    if (!row?.signed_spec_pdf) return res.status(404).json({ error: 'Подписанная спецификация не прикреплена' });

    // Support both old format (base64 in DB) and new format (filename on disk)
    if (row.signed_spec_pdf.startsWith('data:')) {
      // Legacy: base64 stored in DB — serve and migrate on the fly
      const buf = Buffer.from(row.signed_spec_pdf.replace(/^data:application\/pdf;base64,/, ''), 'base64');
      const fname = `${req.params.id}.pdf`;
      fs.writeFileSync(path.join(SIGNED_DIR, fname), buf);
      run("UPDATE requests SET signed_spec_pdf=? WHERE id=?", [fname, req.params.id]);
      saveDb();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${row.spec_num}_подписано.pdf"`);
      return res.send(buf);
    }

    const fpath = path.join(SIGNED_DIR, path.basename(row.signed_spec_pdf));
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Файл не найден на диске' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${row.spec_num}_подписано.pdf"`);
    res.send(fs.readFileSync(fpath));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Network folder layout ─────────────────────────────────────────────────────
// ── Network folder / WebDAV file layout ──────────────────────────────────────
app.post('/api/requests/:id/layout-files', operatorOrAdmin, express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const reqId = req.params.id;
    const row = query('SELECT * FROM requests WHERE id=?', [reqId])[0];
    if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
    const r = rowToRequest(row);

    const settingsRows = db.exec('SELECT key, value FROM settings');
    const cfg = { ...DEFAULT_SETTINGS };
    if (settingsRows[0]?.values) settingsRows[0].values.forEach(([k,v]) => { if (k in cfg) cfg[k] = v; });

    const rootPath = (cfg.networkFolder || '').trim();
    if (!rootPath) return res.status(400).json({ error: 'Не указана папка назначения в Конфиге' });

    const isWebDav = /^https?:\/\//i.test(rootPath);

    const date = new Date(r.date || Date.now());
    const year = String(date.getFullYear());
    const monthNum = String(date.getMonth() + 1).padStart(2, '0');
    const RU_M = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const monthFolder = `${monthNum}_${RU_M[date.getMonth()]}`;
    const orgFolder   = (r.orgShort || r.orgFull || 'Организация').replace(/[\\/:*?"<>|]/g, '_');
    const safeName    = (r.name || 'Заявка').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    const results     = [];

    // ── WebDAV (Nextcloud / ownCloud / любой WebDAV) ──────────────────────────
    if (isWebDav) {
      const https = require('https');
      const http  = require('http');
      const baseUrl = rootPath.replace(/\/$/, '');
      const user = cfg.networkUser || '';
      const pass = cfg.networkPass || '';
      const authHeader = (user && pass)
        ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
        : null;

      function davReq(method, urlStr, body, extraHeaders = {}) {
        return new Promise((resolve, reject) => {
          const parsed = new URL(urlStr);
          const lib = parsed.protocol === 'https:' ? https : http;
          const headers = {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...extraHeaders,
          };
          if (body) {
            headers['Content-Type']   = 'application/octet-stream';
            headers['Content-Length'] = body.length;
          }
          const r2 = lib.request({
            hostname: parsed.hostname,
            port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path:     parsed.pathname + parsed.search,
            method, headers,
            rejectUnauthorized: false,
          }, resp => {
            const chunks = [];
            resp.on('data', d => chunks.push(d));
            resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks) }));
          });
          r2.on('error', reject);
          if (body) r2.write(body);
          r2.end();
        });
      }

      async function davMkdir(u) {
        const r2 = await davReq('MKCOL', u);
        if (r2.status !== 201 && r2.status !== 405 && r2.status !== 301) {
          throw new Error(`MKCOL ${u} → HTTP ${r2.status}`);
        }
      }

      async function davPut(u, buf) {
        const r2 = await davReq('PUT', u, buf);
        if (r2.status < 200 || r2.status > 299) {
          throw new Error(`PUT ${u} → HTTP ${r2.status}: ${r2.body.toString().slice(0, 200)}`);
        }
      }

      async function davList(u) {
        // PROPFIND Depth:1 → returns XML with hrefs
        const body = Buffer.from('<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>');
        const r2 = await davReq('PROPFIND', u, body, { Depth: '1', 'Content-Type': 'application/xml' });
        if (r2.status === 404) return [];
        const xml = r2.body.toString();
        // Extract last path segment from each <href>
        return [...xml.matchAll(/<[^:>]*:?href[^>]*>([^<]+)<\/[^:>]*:?href>/g)]
          .map(m => decodeURIComponent(m[1].split('/').filter(Boolean).pop() || ''));
      }

      // encode each segment separately
      const seg = (...parts) => baseUrl + '/' + parts.map(p => encodeURIComponent(p)).join('/');

      // Create folder hierarchy
      await davMkdir(seg(year));
      await davMkdir(seg(year, monthFolder));
      await davMkdir(seg(year, monthFolder, orgFolder));

      // Find existing or next folder for this request
      const children = await davList(seg(year, monthFolder, orgFolder));
      let maxNum = 0, requestFolderName = null;
      for (const name of children) {
        const m = name.match(/^(\d+)_/);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
        if (r.specNum && name.includes(r.specNum)) requestFolderName = name;
      }
      if (!requestFolderName) {
        requestFolderName = `${String(maxNum + 1).padStart(2, '0')}_${safeName}`;
      }

      await davMkdir(seg(year, monthFolder, orgFolder, requestFolderName));
      await davMkdir(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты'));

      if (req.body.docxBase64) {
        const name = `${r.specNum}_спецификация.docx`;
        await davPut(seg(year, monthFolder, orgFolder, requestFolderName, name), Buffer.from(req.body.docxBase64, 'base64'));
        results.push({ type: 'docx', name });
      }
      if (r.signedSpecPdf === '__has_pdf__') {
        const pdfPath = path.join(SIGNED_DIR, path.basename(query('SELECT signed_spec_pdf FROM requests WHERE id=?', [reqId])[0]?.signed_spec_pdf || ''));
        if (fs.existsSync(pdfPath)) {
          const name = `${r.specNum}_спецификация_подписано.pdf`;
          await davPut(seg(year, monthFolder, orgFolder, requestFolderName, name), fs.readFileSync(pdfPath));
          results.push({ type: 'signed_spec', name });
        }
      }
      if (req.body.excelBase64) {
        const name = `${r.specNum}_расчеты.xlsx`;
        await davPut(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты', name), Buffer.from(req.body.excelBase64, 'base64'));
        results.push({ type: 'excel', name });
      }
      if (Array.isArray(req.body.invoiceFiles)) {
        for (const inv of req.body.invoiceFiles) {
          if (!inv.name || !inv.data) continue;
          // Sanitize filename — strip path separators to prevent traversal
          const safeName = nodePath.basename(inv.name).replace(/[^\w.\-\u0400-\u04ff ]/g, '_').slice(0, 120);
          await davPut(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты', safeName),
            Buffer.from(inv.data.replace(/^data:[^;]+;base64,/, ''), 'base64'));
          results.push({ type: 'invoice', name: safeName });
        }
      }

      const folderUrl = seg(year, monthFolder, orgFolder, requestFolderName);
      return res.json({ ok: true, mode: 'webdav', folderPath: folderUrl, files: results });
    }

    // ── Local / SMB ───────────────────────────────────────────────────────────
    const nodePath = require('path');
    if (cfg.networkUser && cfg.networkPass && process.platform === 'win32' && rootPath.startsWith('\\\\\\\\')) {
      const safeUser = (cfg.networkUser || '').replace(/["&|<>]/g, '');
      const safePass = (cfg.networkPass || '').replace(/["&|<>]/g, '');
      const safePath = rootPath.replace(/["&|<>]/g, '');
      try {
        require('child_process').execSync(
          `net use "${safePath}" /user:"${safeUser}" "${safePass}" /persistent:no`,
          { stdio: 'pipe' }
        );
      } catch(e) { /* already mounted */ }
    }

    const orgPath = nodePath.join(rootPath, year, monthFolder, orgFolder);
    fs.mkdirSync(orgPath, { recursive: true });

    let maxNum = 0, requestFolderName = null;
    try {
      for (const e of fs.readdirSync(orgPath, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const m = e.name.match(/^(\d+)_/);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
        if (r.specNum && e.name.includes(r.specNum)) requestFolderName = e.name;
      }
    } catch(e) {}

    if (!requestFolderName) requestFolderName = `${String(maxNum + 1).padStart(2, '0')}_${safeName}`;

    const requestPath = nodePath.join(orgPath, requestFolderName);
    const calcPath    = nodePath.join(requestPath, 'Расчеты');
    fs.mkdirSync(requestPath, { recursive: true });
    fs.mkdirSync(calcPath,    { recursive: true });

    const wb64 = b64 => Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');

    if (req.body.docxBase64) {
      const name = `${r.specNum}_спецификация.docx`;
      fs.writeFileSync(nodePath.join(requestPath, name), Buffer.from(req.body.docxBase64, 'base64'));
      results.push({ type: 'docx', name });
    }
    if (r.signedSpecPdf === '__has_pdf__') {
      const pdfRow = query('SELECT signed_spec_pdf FROM requests WHERE id=?', [reqId])[0];
      const pdfPath = path.join(SIGNED_DIR, nodePath.basename(pdfRow?.signed_spec_pdf || ''));
      if (fs.existsSync(pdfPath)) {
        const name = `${r.specNum}_спецификация_подписано.pdf`;
        fs.writeFileSync(nodePath.join(requestPath, name), fs.readFileSync(pdfPath));
        results.push({ type: 'signed_spec', name });
      }
    }
    if (req.body.excelBase64) {
      const name = `${r.specNum}_расчеты.xlsx`;
      fs.writeFileSync(nodePath.join(calcPath, name), Buffer.from(req.body.excelBase64, 'base64'));
      results.push({ type: 'excel', name });
    }
    if (Array.isArray(req.body.invoiceFiles)) {
      for (const inv of req.body.invoiceFiles) {
        if (!inv.name || !inv.data) continue;
        const safeName = nodePath.basename(inv.name).replace(/[^\w.\-\u0400-\u04ff ]/g, '_').slice(0, 120);
        fs.writeFileSync(nodePath.join(calcPath, safeName), wb64(inv.data));
        results.push({ type: 'invoice', name: safeName });
      }
    }

    res.json({ ok: true, mode: 'local', folderPath: requestPath, files: results });
  } catch(e) {
    console.error('[layout-files]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Bitrix24 webhook ──────────────────────────────────────────────────────────
app.post('/api/send-bitrix', operatorOrAdmin, async (req, res) => {
  try {
    // Get webhook URL from settings
    const rows = db.exec("SELECT value FROM settings WHERE key='bitrixWebhook'");
    const webhookUrl = rows[0]?.values?.[0]?.[0] || '';
    if (!webhookUrl) return res.status(400).json({ error: 'Webhook URL не настроен. Укажите его в Конфиге.' });

    const r = req.body; // full request object sent from frontend
    if (!r || !r.specNum) return res.status(400).json({ error: 'Некорректные данные заявки' });

    // Build a human-readable comment for Bitrix task/deal
    const lines = [
      `📦 Заявка ${r.specNum}`,
      `Организация: ${r.orgFull || r.orgShort || '—'}`,
      `МОЛ: ${r.mol || '—'}`,
      `Дата: ${r.date || '—'}`,
      `Поставщик: ${r.supplier || '—'}`,
      `Адрес доставки: ${r.address || '—'}`,
      `Сумма (продажа): ${Number(r.total || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`,
      '',
      'Позиции:',
      ...(r.positions || []).map((p, i) =>
        `  ${i + 1}. ${p.name} — ${p.qty} ${p.unit || 'шт'} × ${Number(p.purchasePrice || 0).toLocaleString('ru-RU')} ₽`
      ),
    ];
    if (r.comment) lines.push('', `Комментарий: ${r.comment}`);

    const payload = {
      fields: {
        TITLE:       `Закупка ${r.specNum}`,
        DESCRIPTION: lines.join('\n'),
        RESPONSIBLE_ID: 1,   // default — user can override in Bitrix
        // Optional: link to deal/task via r.bitrix if it's a deal ID
        ...(r.bitrix ? { OPPORTUNITY: r.bitrix } : {}),
      }
    };

    // Determine method: if webhook ends with crm.deal.add / tasks.task.add — use as-is,
    // otherwise default to crm.deal.add
    const base = webhookUrl.replace(/\/$/, '');
    const method = base.endsWith('tasks.task.add') ? '' : '/crm.deal.add.json';
    const url = base.endsWith('.json') ? base : `${base}${method}`;

    const https = require('https');
    const http  = require('http');
    const body  = JSON.stringify(payload);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      };
      const req2 = lib.request(options, resp => {
        let data = '';
        resp.on('data', d => data += d);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data }); }
        });
      });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });

    if (result.error) return res.status(502).json({ error: `Bitrix ответил ошибкой: ${result.error_description || result.error}` });
    res.json({ ok: true, bitrixResult: result });
  } catch(e) {
    console.error('[bitrix]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Version ───────────────────────────────────────────────────────────────────
const PKG_VERSION = (() => {
  try { return require('./package.json').version; } catch(e) { return '26w31-b01'; }
})();

// Test folder connection
app.post('/api/test-folder', operatorOrAdmin, async (req, res) => {
  const { path: folderPath, user, pass } = req.body || {};
  if (!folderPath) return res.status(400).json({ ok: false, error: 'Путь не указан' });
  const isWebDav = /^https?:\/\//i.test(folderPath);
  try {
    if (isWebDav) {
      const https = require('https');
      const http  = require('http');
      const parsed = new URL(folderPath.replace(/\/$/, ''));
      const lib = parsed.protocol === 'https:' ? https : http;
      const authHeader = (user && pass) ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : null;
      const status = await new Promise((resolve, reject) => {
        const r = lib.request({
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname,
          method: 'PROPFIND',
          headers: { ...(authHeader ? { Authorization: authHeader } : {}), Depth: '0', 'Content-Type': 'application/xml' },
          rejectUnauthorized: false,
        }, resp => resolve(resp.statusCode));
        r.on('error', reject);
        r.end();
      });
      if (status === 207 || status === 200) return res.json({ ok: true, mode: 'webdav', status });
      if (status === 401) return res.json({ ok: false, error: 'Ошибка авторизации (401). Проверьте логин и пароль.' });
      if (status === 404) return res.json({ ok: false, error: 'Папка не найдена (404). Проверьте URL и путь.' });
      return res.json({ ok: false, error: `Сервер ответил: HTTP ${status}` });
    } else {
      if (!fs.existsSync(folderPath)) return res.json({ ok: false, error: 'Папка не найдена или недоступна' });
      fs.accessSync(folderPath, fs.constants.W_OK);
      return res.json({ ok: true, mode: 'local' });
    }
  } catch(e) {
    return res.json({ ok: false, error: e.message });
  }
});

app.get('/api/version', operatorOrAdmin, (req, res) => {
  res.json({ version: PKG_VERSION });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  try {
    const row = db.exec('SELECT COUNT(*) as c FROM requests')[0];
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
    const https = require('https');
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
