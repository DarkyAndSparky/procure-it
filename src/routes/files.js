const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { query, run, saveDb, rowToRequest } = require('../db/connection');
const { auditLog } = require('../db/audit');
const { operatorOrAdmin } = require('../auth/middleware');
const { SIGNED_DIR, INVOICE_DIR, DEFAULT_SETTINGS } = require('../config');
const { layoutFiles, openFolder, testFolder, checkLayoutStatus } = require('../services/fileLayoutService');

function readSettings() {
  const rows = query('SELECT key, value FROM settings');
  const cfg = { ...DEFAULT_SETTINGS };
  rows.forEach(({ key, value }) => { if (key in cfg) cfg[key] = value; });
  return cfg;
}

// Защита в глубину (defense in depth) для роутов, которые строят путь на
// диске из req.params.id. Сама по себе заявка с "грязным" id (../.. и т.п.)
// уже не может быть создана через POST /api/requests (id всегда генерируется
// сервером), но записи, восстановленные из старого бэкапа через /api/restore,
// теоретически могли сохранить произвольный id — так что здесь тоже сверяем
// формат перед тем как использовать id в имени файла.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
function requireSafeId(req, res, next) {
  if (!SAFE_ID.test(req.params.id)) {
    return res.status(400).json({ error: 'Некорректный идентификатор заявки' });
  }
  next();
}

// ── Signed spec PDF ───────────────────────────────────────────────────────────
// Upload: POST /api/requests/:id/signed-spec  { pdf: base64 }
router.post('/requests/:id/signed-spec', operatorOrAdmin, requireSafeId, express.json({ limit: '20mb' }), (req, res) => {
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
router.get('/requests/:id/signed-spec', operatorOrAdmin, requireSafeId, (req, res) => {
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
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.spec_num + '_подписано.pdf')}`);
      return res.send(buf);
    }

    const fpath = path.join(SIGNED_DIR, path.basename(row.signed_spec_pdf));
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Файл не найден на диске' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.spec_num + '_подписано.pdf')}`);
    res.send(fs.readFileSync(fpath));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Invoice (счёт) file ───────────────────────────────────────────────────────
// Upload: POST /api/requests/:id/invoice-file  { file: base64, name }
router.post('/requests/:id/invoice-file', operatorOrAdmin, requireSafeId, express.json({ limit: '20mb' }), (req, res) => {
  try {
    const { file, name } = req.body;
    const m = /^data:([\w/.+-]+);base64,/.exec(file || '');
    if (!m) return res.status(400).json({ error: 'Ожидается файл в формате base64' });
    const mime = m[1];
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(mime)) return res.status(400).json({ error: 'Допустимые форматы: PDF, PNG, JPG, WebP' });

    const row = query('SELECT spec_num FROM requests WHERE id=?', [req.params.id])[0];
    if (!row) return res.status(404).json({ error: 'Заявка не найдена' });

    const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1].replace('jpeg', 'jpg');
    const fname = `${req.params.id}.${ext}`;
    // Remove any previous invoice file with a different extension
    try {
      for (const f of fs.readdirSync(INVOICE_DIR)) {
        if (f.startsWith(`${req.params.id}.`)) fs.unlinkSync(path.join(INVOICE_DIR, f));
      }
    } catch(e) {}
    const buf = Buffer.from(file.replace(/^data:[\w/.+-]+;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(INVOICE_DIR, fname), buf);

    // Баг (найден по репорту пользователя): раньше исходное имя файла
    // (например, "M0952860_Proforma.pdf" из письма поставщика) нигде не
    // сохранялось — в БД писалось только служебное имя "${id}.pdf", а при
    // раскладке в сетевую папку счёт всегда переименовывался в
    // "${specNum}_счет.pdf", даже когда это чужой документ с собственным
    // номером счёта, который нужен для сверки с поставщиком. Сохраняем
    // оригинальное имя отдельно и используем его при раскладке — см.
    // services/fileLayoutService.js.
    const originalName = (name || '').trim().slice(0, 200);
    run('UPDATE requests SET invoice_file=?, invoice_file_original_name=? WHERE id=?', [fname, originalName, req.params.id]);
    saveDb();
    auditLog('UPDATE', req.params.id, 'invoice_file', '', 'uploaded', { name: originalName || fname });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Download: GET /api/requests/:id/invoice-file
router.get('/requests/:id/invoice-file', operatorOrAdmin, requireSafeId, (req, res) => {
  try {
    const row = query('SELECT invoice_file, spec_num FROM requests WHERE id=?', [req.params.id])[0];
    if (!row?.invoice_file) return res.status(404).json({ error: 'Счёт не прикреплён' });
    const fname = path.basename(row.invoice_file);
    const fpath = path.join(INVOICE_DIR, fname);
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Файл не найден на диске' });
    const ext = fname.split('.').pop();
    const mimeMap = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.spec_num + '_счет.' + ext)}`);
    res.send(fs.readFileSync(fpath));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Network folder / WebDAV file layout ──────────────────────────────────────
router.post('/requests/:id/layout-files', operatorOrAdmin, requireSafeId, express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const reqId = req.params.id;
    const row = query('SELECT * FROM requests WHERE id=?', [reqId])[0];
    if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
    const r = rowToRequest(row);
    const cfg = readSettings();
    const result = await layoutFiles(reqId, r, cfg, req.body || {});
    res.json(result);
  } catch(e) {
    console.error('[layout-files]', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Проверка статуса раскладки (read-only) — для бейджа в реестре ──────────
router.get('/requests/:id/layout-status', operatorOrAdmin, requireSafeId, async (req, res) => {
  try {
    const reqId = req.params.id;
    const row = query('SELECT * FROM requests WHERE id=?', [reqId])[0];
    if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
    const r = rowToRequest(row);
    const cfg = readSettings();
    const result = await checkLayoutStatus(reqId, r, cfg);
    res.json(result);
  } catch(e) {
    console.error('[layout-status]', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Open / create request folder in OS file manager ────────────────────────
// Best-effort: works when the server runs on the same machine as the browser
// (this app's normal deployment — start.bat/desktop use). Accepts an optional
// rootPath override for the one-off "root folder not configured yet" flow.
router.post('/requests/:id/open-folder', operatorOrAdmin, requireSafeId, express.json({ limit: '10kb' }), (req, res) => {
  try {
    const row = query('SELECT * FROM requests WHERE id=?', [req.params.id])[0];
    if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
    const r = rowToRequest(row);
    const cfg = readSettings();

    // Проверено при аудите: rootPath от клиента используется здесь ТОЛЬКО для
    // создания дерева папок (fs.mkdirSync) и открытия его в проводнике ОС —
    // сама запись содержимого файлов (docx/excel/счета) всегда идёт через
    // layout-files, который берёт путь исключительно из серверных настроек
    // и клиентский rootPath не принимает вовсе. Поэтому здесь оставляем как
    // есть — это осознанный сценарий первого запуска, когда сетевая папка ещё
    // не настроена и operator легитимно указывает путь вручную (см. фронтенд:
    // prompt при ошибке NO_ROOT). Сохранение выбора как настройки по
    // умолчанию (saveAsDefault) уже ограничено ролью admin — см. ниже.
    const result = openFolder(r, cfg, { rootPath: req.body?.rootPath });

    // Optionally remember this root path for next time (admin only)
    if (req.body && req.body.saveAsDefault && req.userRole === 'admin' && result.mode === 'local') {
      try {
        run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['networkFolder', (req.body.rootPath || cfg.networkFolder).trim()]);
      } catch(e) { /* non-fatal */ }
    }

    res.json(result);
  } catch(e) {
    console.error('[open-folder]', e);
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// Test folder connection
router.post('/test-folder', operatorOrAdmin, express.json({ limit: '10kb' }), async (req, res) => {
  const { path: folderPath, user, pass } = req.body || {};
  if (!folderPath) return res.status(400).json({ ok: false, error: 'Путь не указан' });
  try {
    const result = await testFolder(folderPath, user, pass);
    res.json(result);
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
