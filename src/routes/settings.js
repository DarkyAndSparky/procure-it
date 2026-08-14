const express = require('express');
const router = express.Router();

const { getDb, saveDb } = require('../db/connection');
const { operatorOrAdmin, adminOnly } = require('../auth/middleware');
const { DEFAULT_SETTINGS } = require('../config');

const PKG_VERSION = (() => {
  // package.json — единственный источник правды для версии (см. scripts/sync-version.js,
  // который подставляет её же во все остальные места: README, docs/index.html,
  // docker-compose.yml). Фолбэк здесь — не конкретная версия (иначе он сам стал бы
  // ещё одним местом, которое незаметно устареет), а нейтральная метка на случай,
  // если package.json почему-то не читается (битая установка).
  try { return require('../../package.json').version; } catch(e) { return 'unknown'; }
})();

router.get('/settings', operatorOrAdmin, (req, res) => {
  try {
    const rows = getDb().exec('SELECT key, value FROM settings');
    const result = { ...DEFAULT_SETTINGS };
    if (rows.length && rows[0].values) {
      rows[0].values.forEach(([k, v]) => { if (k in result) result[k] = v; });
    }
    // Never expose the actual password over the wire — return a sentinel so
    // the UI knows a password is set without leaking it
    if (result.networkPass) result.networkPass = '••••••••';
    // Operators need branding + supplier defaults to create requests/specs,
    // but shouldn't see infra credentials/webhooks — only admins get those.
    if (req.userRole !== 'admin') {
      const { networkFolder, networkUser, networkPass, bitrixWebhook, statusWebhook, backupFolder, ...safe } = result;
      return res.json(safe);
    }
    res.json(result);
  } catch(e) { res.json({ ...DEFAULT_SETTINGS }); }
});

router.put('/settings', adminOnly, (req, res) => {
  try {
    const db = getDb();
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

router.get('/version', operatorOrAdmin, (req, res) => {
  res.json({ version: PKG_VERSION });
});

// ── Полная информация «О системе» — динамический список зависимостей и
// окружения, для отдельной страницы (не путать с мини-виджетом в сайдбаре,
// у которого только версия+GitHub+лицензия и трогать его не нужно).
router.get('/system-info', operatorOrAdmin, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const pkg = require('../../package.json');
    const { resolveBackupDir } = require('../services/backupService');

    // Резолвим фактически установленные версии зависимостей из их
    // собственных package.json в node_modules — надёжнее, чем диапазон
    // версий (^x.y.z) из package.json самого приложения, который не
    // говорит, что реально стоит после npm install.
    const resolveInstalledVersion = (name) => {
      try {
        const p = require.resolve(path.join(name, 'package.json'), { paths: [path.join(__dirname, '../..')] });
        return require(p).version;
      } catch(e) {
        // Фолбэк на обычную Node-резолюцию (NODE_PATH/глобальные пакеты) —
        // на случай нестандартной установки, где не все пакеты лежат в
        // локальном node_modules проекта.
        try { return require(path.join(name, 'package.json')).version; } catch(e2) { return null; }
      }
    };

    const deps = Object.entries(pkg.dependencies || {}).map(([name, range]) => ({
      name, range, installed: resolveInstalledVersion(name),
    }));
    const devDeps = Object.entries(pkg.devDependencies || {}).map(([name, range]) => ({
      name, range, installed: resolveInstalledVersion(name),
    }));

    const dbRows = getDb().exec(`SELECT
      (SELECT COUNT(*) FROM requests) as requests,
      (SELECT COUNT(*) FROM orgs) as orgs,
      (SELECT COUNT(*) FROM users) as users`);
    const counts = dbRows.length ? { requests: dbRows[0].values[0][0], orgs: dbRows[0].values[0][1], users: dbRows[0].values[0][2] } : {};

    let dbSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(require('../config').DB_FILE).size; } catch(e) {}

    // Время последнего автобэкапа — самый свежий .db-снапшот в текущей
    // (настроенной или дефолтной) папке бэкапа.
    let lastBackupAt = null;
    try {
      const backupDir = resolveBackupDir();
      const dbFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.db'));
      if (dbFiles.length) {
        const latest = dbFiles
          .map(f => ({ f, mtime: fs.statSync(path.join(backupDir, f)).mtime }))
          .sort((a, b) => b.mtime - a.mtime)[0];
        lastBackupAt = latest.mtime.toISOString();
      }
    } catch(e) {}

    // Мини-changelog — полноценный CHANGELOG.md в проекте не ведётся,
    // поэтому раздел «Последние изменения» на странице «О системе»
    // читает короткий курируемый список отсюда. Обновлять вручную при
    // значимых изменениях (см. src/changelog.js).
    let recentChanges = [];
    try { recentChanges = require('../changelog'); } catch(e) {}

    res.json({
      version: PKG_VERSION,
      name: pkg.name,
      description: pkg.description || '',
      license: pkg.license || 'MIT',
      author: pkg.author || 'DarkyAndSparky',
      repository: (pkg.repository && (pkg.repository.url || pkg.repository)) || 'https://github.com/DarkyAndSparky/procure-it',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSec: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      pid: process.pid,
      dependencies: deps,
      devDependencies: devDeps,
      counts,
      dbSizeBytes,
      lastBackupAt,
      recentChanges,
      env: process.env.NODE_ENV || 'production',
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, PKG_VERSION };
