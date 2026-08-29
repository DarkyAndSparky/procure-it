/**
 * server/routes/settings.routes.js
 *
 * Фаза 3 рефакторинга: настройки, смена пароля и категории, вынесенные
 * из index.js без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { verifyPin } = require('../pin');
const { requireAuth, requireAdmin, requireLogin } = require('../middleware/auth');
const { rateLimitLogin } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { putStylesSchema, putLogoSvgSchema, putCompanyNameSchema, putPasswordSchema } = require('../validation/schemas');
const fs   = require('fs');
const path = require('path');

// Версия — единый источник правды VERSION в корне репозитория, см.
// подробный комментарий в server/index.js. Фолбэк на pkg.version на
// случай отсутствия файла.
const pkg = (() => { try { return require('../../package.json'); } catch(e) { return {}; } })();
const APP_VERSION = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim(); }
  catch(e) { return pkg.version || 'unknown'; }
})();

// INFRA-5: реально установленная версия зависимости (не диапазон из package.json
// приложения) — резолвим из node_modules/<pkg>/package.json, как в procure-it.
function installedVersion(name) {
  try {
    const p = require.resolve(`${name}/package.json`);
    return require(p).version || '?';
  } catch (e) { return 'не установлен'; }
}

function dirSize(dirPath) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(dirPath)) {
      try { total += fs.statSync(path.join(dirPath, f)).size; } catch (e) {}
    }
  } catch (e) {}
  return total;
}

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    company_name: db.getSetting('company_name') || 'IT ASSETS',
    logo_svg:     db.getSetting('logo_svg')     || '',
    styles:       db.getSetting('styles')       || {},
    version:      APP_VERSION,
  });
});

router.put('/styles', requireAuth, validate(putStylesSchema), (req, res) => {
  db.setSetting('styles', req.body.styles);
  res.json({ ok: true });
});

router.put('/logo_svg', requireAuth, validate(putLogoSvgSchema), (req, res) => {
  db.setSetting('logo_svg', req.body.svg.trim());
  res.json({ ok: true });
});

router.put('/company_name', requireAuth, validate(putCompanyNameSchema), (req, res) => {
  db.setSetting('company_name', req.body.company_name);
  res.json({ ok: true, company_name: req.body.company_name });
});

router.put('/password', rateLimitLogin, requireAuth, validate(putPasswordSchema), (req, res) => {
  // Меняем PIN только текущего аутентифицированного пользователя —
  // requireAuth уже проверил x-user-id/x-edit-password выше.
  db.updateUser(req.currentUser.id, { pin: req.body.newPassword });
  res.json({ ok: true });
});

// INFRA-8: короткая выжимка из CHANGELOG.md для карточки «О системе» —
// не полный файл (details/summary и так открывается по клику, но грузить
// туда весь CHANGELOG избыточно), только пункты из первой НЕПУСТОЙ секции
// (обычно [Unreleased], но сразу после релиза он пуст — тогда берём
// последний тег версии, чтобы карточка не показывала пустоту сразу после
// bump'а версии), ограничено 8 пунктами.
//
// Раньше здесь был вариант с лукахедом (?=\n^## \[|$) — сломан на пустых
// секциях: $ с флагом /m матчится в конце ЛЮБОЙ строки, а не только конца
// файла, из-за чего лукахед срабатывал сразу после заголовка секции и
// body всегда оказывался пустым. Через явные индексы заголовков надёжнее
// и читаемее, чем городить экранирование для этого частного случая.
function parseChangelogSummary() {
  try {
    const changelogPath = path.join(__dirname, '..', '..', 'CHANGELOG.md');
    const text = fs.readFileSync(changelogPath, 'utf8');
    const headerRe = /^## \[([^\]]+)\][^\n]*$/gm;
    const headers = [...text.matchAll(headerRe)];

    for (let i = 0; i < headers.length; i++) {
      const bodyStart = headers[i].index + headers[i][0].length;
      const bodyEnd   = i + 1 < headers.length ? headers[i + 1].index : text.length;
      const body      = text.slice(bodyStart, bodyEnd);
      const items = [...body.matchAll(/^- (.+(?:\n {2}.+)*)/gm)]
        .map(m => m[1].replace(/\n\s+/g, ' ').trim())
        .slice(0, 8);
      if (items.length) return items; // первая секция хоть с чем-то — она и есть актуальная
    }
    return [];
  } catch (e) {
    return [];
  }
}

// INFRA-8: технологии проекта — статический список, поддерживается вручную
// (нет смысла резолвить это динамически, стек не меняется каждый релиз).
const TECH_STACK = [
  { name: 'Node.js', role: 'Рантайм' },
  { name: 'Express', role: 'HTTP-сервер' },
  { name: 'lowdb', role: 'JSON-хранилище (config/справочники)' },
  { name: 'SQLite (better-sqlite3)', role: 'Активы и история' },
  { name: 'Vanilla JS', role: 'Фронтенд (без сборки/фреймворка)' },
  { name: 'bcryptjs', role: 'Хеширование паролей' },
];


// размер БД/бэкапов, счётчики сущностей. Тяжелее обычного /api/settings,
// поэтому не отдаётся всем подряд — только requireAdmin.
router.get('/system-info', requireAdmin, (req, res) => {
  const { sqlite } = require('../db/sqlite');
  const { DB_PATH, CFG_PATH, DATA_DIR } = require('../db/store');
  const BACKUP_DIR = path.join(DATA_DIR, 'backups');

  let dbFileSize = 0, cfgFileSize = 0;
  try { dbFileSize = fs.statSync(DB_PATH).size; } catch (e) {}
  try { cfgFileSize = fs.statSync(CFG_PATH).size; } catch (e) {}
  const sqlitePath = path.join(DATA_DIR, 'it-assets.sqlite');
  let sqliteFileSize = 0;
  try { sqliteFileSize = fs.statSync(sqlitePath).size; } catch (e) {}

  let backupCount = 0, lastBackup = null;
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json') || f.endsWith('.zip'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    backupCount = files.length;
    if (files.length) lastBackup = { file: files[0].name, mtime: files[0].mtime };
  } catch (e) {}

  let counts = {};
  try {
    counts.assets  = sqlite.prepare('SELECT COUNT(*) c FROM assets').get().c;
    counts.history = sqlite.prepare('SELECT COUNT(*) c FROM history').get().c;
  } catch (e) {}
  try { counts.employees = (db.getEmployees ? db.getEmployees().length : undefined); } catch (e) {}
  try { counts.users = db.getUsers(true).length; } catch (e) {}

  res.json({
    // INFRA-8: раздел "О программе" — стиль карточки как в procure-it
    // (version/description/license/author/repository).
    about: {
      name: pkg.name || 'it-assets',
      version: APP_VERSION,
      description: pkg.description || '',
      license: pkg.license || '—',
      author: pkg.author || '—',
      repository: (pkg.repository && pkg.repository.url) || pkg.repository || '',
    },
    version: APP_VERSION, // оставлено для обратной совместимости с уже отданными сборками
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime_sec: Math.round(process.uptime()),
      memory_rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    techStack: TECH_STACK,
    recentChanges: parseChangelogSummary(),
    dependencies: Object.keys(pkg.dependencies || {}).reduce((acc, name) => {
      acc[name] = { required: pkg.dependencies[name], installed: installedVersion(name) };
      return acc;
    }, {}),
    storage: {
      db_json_bytes: dbFileSize,
      config_json_bytes: cfgFileSize,
      sqlite_bytes: sqliteFileSize,
      backups: { count: backupCount, last: lastBackup, dir: BACKUP_DIR },
    },
    counts,
  });
});

// INFRA-5: лёгкий эндпоинт для мини-виджета версии (сайдбар и т.п.) —
// умышленно отдельный от /system-info, чтобы не тянуть полный список
// зависимостей туда, где нужна только строка версии. Доступен всем
// авторизованным, не только admin — как в procure-it.
router.get('/version', requireLogin, (req, res) => {
  res.json({ version: APP_VERSION });
});

// INFRA-6: health-бар — быстрая проверка живости ключевых компонент.
// Каждая проверка возвращает status: 'ok' | 'warn' | 'error' + короткую
// деталь для тултипа. Дизайн специально лёгкий (без тяжёлых операций типа
// npm outdated) — этот эндпоинт дергается чаще, чем /system-info.
router.get('/health', requireLogin, (req, res) => {
  const { sqlite } = require('../db/sqlite');
  const { DATA_DIR } = require('../db/store');
  const cert = require('../cert');
  const BACKUP_DIR = path.join(DATA_DIR, 'backups');

  // 1. БД — пробный запрос. Если sqlite недоступна/файл повреждён, упадёт
  //    исключение — это и есть сигнал "error".
  let dbCheck = { status: 'ok', detail: 'OK' };
  try {
    sqlite.prepare('SELECT 1').get();
  } catch (e) {
    dbCheck = { status: 'error', detail: e.message };
  }

  // 2. Бэкапы — автобэкап каждый час (см. index.js), так что свежим
  //    считаем бэкап младше 2 часов (буфер на случай, если сервер только
  //    что запустился и первый автобэкап ещё не прошёл — не менее 90 минут
  //    даёт "warn", а не "error", в первый час работы).
  let backupCheck = { status: 'error', detail: 'Бэкапов нет' };
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json') || f.endsWith('.zip'))
      .map(f => fs.statSync(path.join(BACKUP_DIR, f)).mtime);
    if (files.length) {
      const lastMs = Math.max(...files.map(d => d.getTime()));
      const ageHours = (Date.now() - lastMs) / 3600000;
      if (ageHours < 2) backupCheck = { status: 'ok', detail: `Последний ${ageHours.toFixed(1)} ч назад` };
      else if (ageHours < 6) backupCheck = { status: 'warn', detail: `Последний ${ageHours.toFixed(1)} ч назад` };
      else backupCheck = { status: 'error', detail: `Последний ${Math.round(ageHours)} ч назад` };
    }
  } catch (e) {
    backupCheck = { status: 'error', detail: 'Папка бэкапов недоступна' };
  }
  // Сервер запущен недавно — первый автобэкап ещё не успел пройти,
  // не пугаем "error" в первые полтора часа работы.
  if (backupCheck.status === 'error' && process.uptime() < 5400) {
    backupCheck = { status: 'warn', detail: 'Сервер недавно запущен, бэкап ещё не создан' };
  }

  // 3. Сертификат — переиспользуем certDaysLeft() из cert.js (INFRA-2/6).
  let certCheck = { status: 'ok', detail: 'HTTP-режим (без TLS)' };
  const daysLeft = cert.certDaysLeft();
  if (daysLeft != null) {
    if (daysLeft < 0)       certCheck = { status: 'error', detail: 'Сертификат просрочен' };
    else if (daysLeft < 30) certCheck = { status: 'warn',  detail: `Истекает через ${daysLeft} дн.` };
    else                    certCheck = { status: 'ok',    detail: `Действителен ещё ${daysLeft} дн.` };
  }

  // 4. Диск — свободное место под data/. Пороги: <5% или <500MB = error,
  //    <15% или <2GB = warn.
  let diskCheck = { status: 'ok', detail: 'OK' };
  try {
    const st = fs.statfsSync(DATA_DIR);
    const freeBytes  = st.bavail * st.bsize;
    const totalBytes = st.blocks * st.bsize;
    const freePct    = totalBytes ? (freeBytes / totalBytes) * 100 : 100;
    const freeGB     = freeBytes / (1024 ** 3);
    if (freeGB < 0.5 || freePct < 5)       diskCheck = { status: 'error', detail: `${freeGB.toFixed(1)} GB свободно (${freePct.toFixed(1)}%)` };
    else if (freeGB < 2 || freePct < 15)   diskCheck = { status: 'warn',  detail: `${freeGB.toFixed(1)} GB свободно (${freePct.toFixed(1)}%)` };
    else                                    diskCheck = { status: 'ok',    detail: `${freeGB.toFixed(1)} GB свободно (${freePct.toFixed(1)}%)` };
  } catch (e) {
    diskCheck = { status: 'warn', detail: 'Не удалось определить (' + e.message + ')' };
  }

  const checks = { db: dbCheck, backup: backupCheck, cert: certCheck, disk: diskCheck };
  const overall = Object.values(checks).some(c => c.status === 'error') ? 'error'
                : Object.values(checks).some(c => c.status === 'warn')  ? 'warn'
                : 'ok';

  res.json({ overall, checks });
});

module.exports = router;
