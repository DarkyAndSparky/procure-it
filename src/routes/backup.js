const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { getDb, query, run, saveDb, rowToRequest } = require('../db/connection');
const { adminOnly, operatorOrAdmin } = require('../auth/middleware');
const { DATA_DIR, BACKUP_DIR, SIGNED_DIR, INVOICE_DIR, DEFAULT_SETTINGS } = require('../config');
const { doBackup, resolveBackupDir } = require('../services/backupService');

module.exports = (strictLimiter) => {
  router.get('/backup', adminOnly, (req, res) => {
    const orgs      = query('SELECT * FROM orgs');
    // ВАЖНО: rowToRequest() отдаёт signedSpecPdf/invoiceFile как заглушки
    // ('__has_pdf__'/'__has_file__'), а не реальные имена файлов — это верно
    // для обычных API-ответов (чтобы не светить путь клиенту), но для бэкапа
    // нужны настоящие имена файлов, иначе восстановление не сможет привязать
    // прикреплённые файлы обратно к заявкам. Подмешиваем их поверх маппинга.
    const rawFileRows = Object.fromEntries(
      query('SELECT id, signed_spec_pdf, invoice_file, invoice_file_original_name FROM requests').map(r => [r.id, r])
    );
    const requests  = query('SELECT * FROM requests').map(rowToRequest).map(r => ({
      ...r,
      signedSpecPdf: rawFileRows[r.id]?.signed_spec_pdf || '',
      invoiceFile:   rawFileRows[r.id]?.invoice_file || '',
      invoiceFileOriginalName: rawFileRows[r.id]?.invoice_file_original_name || '',
    }));
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
    res.json({ version: 4, exported: new Date().toISOString(), orgs, requests, addresses, templates, settings, audit: auditRows, users });
  });

  router.post('/restore', adminOnly, strictLimiter, (req, res) => {
    const { orgs=[], requests=[], addresses=[], templates=[] } = req.body;
    let filesRestored = 0, filesMissing = 0;
    // Уязвимость (найдена при аудите): id заявок/организаций из бэкапа
    // раньше писались в БД без проверки формата. Сама по себе загрузка
    // JSON-бэкапа — действие только для admin, но восстановленный id затем
    // попадает НЕЭКРАНИРОВАННЫМ в атрибуты onclick фронтенда (id используется
    // в одинарных кавычках внутри JS-строки — см. фикс escJsAttr() в
    // public/js/helpers.js), так что id вида XSS');alert(1);// превращался в
    // выполняющийся код при простом открытии реестра ЛЮБЫМ пользователем —
    // то есть один тронутый/скомпрометированный бэкап-файл давал сохранённый
    // XSS на всех, кто потом откроет реестр. Раньше id всегда были простыми
    // числами (Date.now()), но раз это больше не гарантия (JSON можно
    // отредактировать руками перед восстановлением), проверяем формат явно.
    const SAFE_ID = /^[A-Za-z0-9_-]+$/;
    function safeId(id, fallbackPrefix) {
      return SAFE_ID.test(String(id)) ? String(id) : `${fallbackPrefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    }
    try {
      if (orgs.length) {
        run('DELETE FROM orgs');
        for (const o of orgs) {
          run('INSERT OR REPLACE INTO orgs (id,full,short,prefix,signatory,contract,address,supplier,stamp,folder) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [safeId(o.id, 'org-'), o.full, o.short, o.prefix, o.signatory||'', o.contract||'', o.address||'', o.supplier||'', o.stamp !== undefined ? String(o.stamp) : '1', o.folder||'']);
        }
      }
      if (requests.length) {
        run('DELETE FROM requests');
        const SENTINELS = new Set(['__has_pdf__', '__has_file__']);
        // Ищем в зеркале ТЕКУЩЕЙ настроенной папки бэкапа, а если там нет —
        // в старом дефолтном месте (на случай если папку бэкапа сменили
        // ПОСЛЕ того, как файлы туда уже были сохранены).
        const currentBackupDir = resolveBackupDir();
        const FILES_MIRROR_CANDIDATES = [
          path.join(currentBackupDir, 'files_mirror'),
          path.join(BACKUP_DIR, 'files_mirror'),
        ];
        for (const r of requests) {
          // Бэкапы, снятые до этого фикса, могли содержать заглушки
          // '__has_pdf__'/'__has_file__' вместо реальных имён файлов —
          // писать их в БД как имя файла нельзя, иначе привязка сломается.
          const signedSpecPdf = SENTINELS.has(r.signedSpecPdf) ? '' : (r.signedSpecPdf || '');
          const invoiceFile   = SENTINELS.has(r.invoiceFile)   ? '' : (r.invoiceFile || '');
          const invoiceFileOriginalName = String(r.invoiceFileOriginalName || '').slice(0, 200);
          const reqId = safeId(r.id, 'req-');
          run(`INSERT OR REPLACE INTO requests (id,spec_num,org_id,org_full,org_short,org_signatory,org_stamp,bitrix,name,mol,date,address,supplier,invoice_num,contract,status,comment,is_realization,delivery_cost,markup,total_purchase,total,positions,doc_type,signed_spec_pdf,invoice_file,invoice_file_original_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [reqId, r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'', r.orgStamp !== undefined ? (r.orgStamp?'1':'0') : '1',
             r.bitrix||'', r.name, r.mol||'', r.date||'', r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
             r.status||'new', r.comment||'', r.isRealization?1:0,
             r.deliveryCost||0, (r.markup!==undefined&&r.markup!==null?r.markup:5), r.totalPurchase||0, r.total||0,
             JSON.stringify(r.positions||[]), r.docType || 'goods', signedSpecPdf, invoiceFile, invoiceFileOriginalName, r.createdAt||new Date().toISOString()]);

          // Сама база хранит только имя файла — реальный PDF в JSON-бэкапе не
          // лежит (см. /api/backup). Если физического файла нет на диске
          // (например, восстанавливаемся после потери data/signed_specs или
          // data/invoices), пробуем достать его из зеркала files_mirror,
          // которое обновляется при каждом автобэкапе.
          for (const [fname, destDir, mirrorSub] of [
            [signedSpecPdf, SIGNED_DIR, 'signed_specs'],
            [invoiceFile,   INVOICE_DIR, 'invoices'],
          ]) {
            if (!fname) continue;
            const destPath = path.join(destDir, path.basename(fname));
            if (fs.existsSync(destPath)) continue;
            let mirrorPath = null;
            for (const mirrorRoot of FILES_MIRROR_CANDIDATES) {
              const candidate = path.join(mirrorRoot, mirrorSub, path.basename(fname));
              if (fs.existsSync(candidate)) { mirrorPath = candidate; break; }
            }
            if (mirrorPath) {
              fs.mkdirSync(destDir, { recursive: true });
              fs.copyFileSync(mirrorPath, destPath);
              filesRestored++;
            } else {
              filesMissing++;
              console.warn(`[restore] Файл не найден ни на диске, ни в зеркале бэкапов: ${fname} (заявка ${r.id})`);
            }
          }
        }
        if (filesRestored || filesMissing) {
          console.log(`[restore] Прикреплённые файлы: восстановлено из зеркала — ${filesRestored}, не найдено — ${filesMissing}`);
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
      try { getDb().run('DELETE FROM sessions'); } catch(e) {}
      res.json({ ok: true, restored: { orgs: orgs.length, requests: requests.length }, files: { restored: filesRestored, missing: filesMissing } });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Эндпоинт для ручного бэкапа БД (бинарный .db файл)
  router.get('/backup/db', adminOnly, strictLimiter, (req, res) => {
    try {
      doBackup();
      const dir = resolveBackupDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort().reverse();
      if (files.length === 0) return res.status(500).json({ error: 'Нет бэкапов' });
      const latest = path.join(dir, files[0]);
      res.download(latest, files[0]);
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/audit', operatorOrAdmin, (req, res) => {
    const { request_id, limit = 50 } = req.query;
    let sql = 'SELECT * FROM audit_log';
    const params = [];
    if (request_id) { sql += ' WHERE request_id = ?'; params.push(request_id); }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(parseInt(limit) || 50);
    res.json(query(sql, params));
  });

  return router;
};
