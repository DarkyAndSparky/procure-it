const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { getDb, query, saveDb, rowToRequest } = require('../db/connection');
const { adminOnly, operatorOrAdmin } = require('../auth/middleware');
const { BACKUP_DIR, SIGNED_DIR, INVOICE_DIR, DEFAULT_SETTINGS } = require('../config');
const { doBackup, resolveBackupDir } = require('../services/backupService');

module.exports = (strictLimiter) => {
  router.get('/backup', adminOnly, strictLimiter, (req, res) => {
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
    // Исключаем из бэкапа секреты, а не только конфигурацию: networkPass —
    // очевидный пароль, но bitrixWebhook/statusWebhook — тоже секреты, хоть
    // и выглядят как обычный URL. URL вебхука Bitrix24 сам является ключом
    // доступа (https://.../rest/1/КЛЮЧ/), а statusWebhook может указывать на
    // Slack/Telegram/другой сервис с токеном в самом URL. Бэкап нередко
    // пересылают («вот файл, восстанови для отладки») — эти поля не должны
    // уезжать вместе с ним. При восстановлении их нужно будет прописать в
    // Настройках заново (админом, вручную) — это осознанный компромисс.
    const SECRET_SETTINGS = ['networkPass', 'bitrixWebhook', 'statusWebhook'];
    const settings = Object.fromEntries(
      settingsRows.filter(r => !SECRET_SETTINGS.includes(r.key)).map(r => [r.key, r.value])
    );
    // Include users (with hashed passwords) so restore preserves auth
    const users = query('SELECT id, username, password, salt, role, must_change_password, created_at FROM users');
    res.setHeader('Content-Disposition', `attachment; filename="zakupki_backup_${date}.json"`);
    res.json({ version: 4, exported: new Date().toISOString(), orgs, requests, addresses, templates, settings, audit: auditRows, users });
  });

  router.post('/restore', adminOnly, strictLimiter, (req, res) => {
    const { orgs=[], requests=[], addresses=[], templates=[] } = req.body;
    let filesRestored = 0, filesMissing = 0;
    let orgsInserted = 0, requestsInserted = 0, usersInserted = 0;
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
    // Баг (найден при аудите перед слиянием dev→main): restore делал
    // DELETE FROM orgs/requests/users и сразу же построчно вставлял новые
    // записи БЕЗ проверки, что вставка вообще удалась (run() глотает
    // исключения и возвращает false, но возврат не проверялся) — если
    // формат бэкапа оказывался несовместимым и КАЖДАЯ вставка проваливалась,
    // таблица оставалась пустой: для users это означало полную блокировку
    // входа в систему без единого способа восстановиться, кроме прямого
    // доступа к файлу БД. Плюс ответ API отдавал `restored: orgs.length` —
    // размер ВХОДНОГО массива, а не число реально вставленных строк, то
    // есть врал об успехе даже при полном провале.
    // Фикс: вся операция — одна SQLite-транзакция. Либо восстановление
    // применяется целиком, либо (при любой ошибке) откатывается целиком —
    // прежнее состояние БД остаётся нетронутым. saveDb() — один раз в
    // конце, а не на каждый run() по пути (заодно и быстрее — раньше это
    // был full db.export()+writeFileSync на КАЖДУЮ вставленную строку).
    const db = getDb();
    function txRun(sql, params = []) {
      try { db.run(sql, params); return true; }
      catch(e) { console.error('[restore] Run error:', sql, e.message); return false; }
    }
    try {
      db.run('BEGIN TRANSACTION');
      if (orgs.length) {
        txRun('DELETE FROM orgs');
        for (const o of orgs) {
          if (!o.full || !o.short) { console.warn(`[restore] Организация без full/short пропущена: id=${o.id}`); continue; }
          const ok = txRun('INSERT OR REPLACE INTO orgs (id,full,short,prefix,signatory,contract,address,supplier,stamp,folder) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [safeId(o.id, 'org-'), o.full, o.short, o.prefix||'', o.signatory||'', o.contract||'', o.address||'', o.supplier||'', o.stamp !== undefined ? String(o.stamp) : '1', o.folder||'']);
          if (ok) orgsInserted++;
        }
      }
      if (requests.length) {
        txRun('DELETE FROM requests');
        const SENTINELS = new Set(['__has_pdf__', '__has_file__']);
        // Ищем в зеркале ТЕКУЩЕЙ настроенной папки бэкапа, а если там нет —
        // в старом дефолтном месте (на случай если папку бэкапа сменили
        // ПОСЛЕ того, как файлы туда уже были сохранены).
        const currentBackupDir = resolveBackupDir();
        // Ищем файлы в снапшоте, соответствующем восстанавливаемой DB
        // (files_<stamp>/), затем в общем зеркале files_mirror (старые бэкапы),
        // затем в дефолтном месте. Порядок важен: снапшот гарантированно
        // синхронен с DB, зеркало — нет.
        const dbFiles = fs.readdirSync(currentBackupDir)
          .filter(f => f.startsWith('zakupki_') && f.endsWith('.db'))
          .sort().reverse(); // свежий снапшот первым
        const snapshotCandidates = dbFiles.map(f => {
          const stamp = f.replace(/^zakupki_/, '').replace(/\.db$/, '');
          return path.join(currentBackupDir, `files_${stamp}`);
        });
        if (currentBackupDir !== BACKUP_DIR) {
          const altFiles = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('zakupki_') && f.endsWith('.db'))
            .sort().reverse() : [];
          altFiles.forEach(f => {
            const stamp = f.replace(/^zakupki_/, '').replace(/\.db$/, '');
            snapshotCandidates.push(path.join(BACKUP_DIR, `files_${stamp}`));
          });
        }
        const FILES_MIRROR_CANDIDATES = [
          ...snapshotCandidates,
          path.join(currentBackupDir, 'files_mirror'),
          path.join(BACKUP_DIR, 'files_mirror'),
        ];
        for (const r of requests) {
          if (!r.name) { console.warn(`[restore] Заявка без name пропущена: id=${r.id}`); continue; }
          // Бэкапы, снятые до этого фикса, могли содержать заглушки
          // '__has_pdf__'/'__has_file__' вместо реальных имён файлов —
          // писать их в БД как имя файла нельзя, иначе привязка сломается.
          const signedSpecPdf = SENTINELS.has(r.signedSpecPdf) ? '' : (r.signedSpecPdf || '');
          const invoiceFile   = SENTINELS.has(r.invoiceFile)   ? '' : (r.invoiceFile || '');
          const invoiceFileOriginalName = String(r.invoiceFileOriginalName || '').slice(0, 200);
          const reqId = safeId(r.id, 'req-');
          const ok = txRun(`INSERT OR REPLACE INTO requests (id,spec_num,org_id,org_full,org_short,org_signatory,org_stamp,bitrix,name,mol,date,address,supplier,invoice_num,contract,status,comment,is_realization,delivery_cost,markup,total_purchase,total,positions,doc_type,signed_spec_pdf,invoice_file,invoice_file_original_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [reqId, r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'', r.orgStamp !== undefined ? (r.orgStamp?'1':'0') : '1',
             r.bitrix||'', r.name, r.mol||'', r.date||'', r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
             r.status||'new', r.comment||'', r.isRealization?1:0,
             r.deliveryCost||0, (r.markup!==undefined&&r.markup!==null?r.markup:5), r.totalPurchase||0, r.total||0,
             JSON.stringify(r.positions||[]), r.docType || 'goods', signedSpecPdf, invoiceFile, invoiceFileOriginalName, r.createdAt||new Date().toISOString()]);
          if (!ok) continue;
          requestsInserted++;

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
        txRun('INSERT OR IGNORE INTO addresses (address) VALUES (?)', [a]);
      }
      if (templates.length) {
        txRun('DELETE FROM templates');
        for (const t of templates) {
          txRun('INSERT INTO templates (name,positions) VALUES (?,?)', [t.name, JSON.stringify(t.positions||[])]);
        }
      }
      // Restore settings
      if (req.body.settings && typeof req.body.settings === 'object') {
        const allowed = Object.keys(DEFAULT_SETTINGS);
        for (const [k, v] of Object.entries(req.body.settings)) {
          if (allowed.includes(k)) txRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [k, String(v)]);
        }
      }
      // Restore users (preserve passwords as-is — already hashed)
      // Уязвимость (найдена при аудите): в отличие от POST/PUT /api/users,
      // которые проверяют role по белому списку, эта ветка раньше принимала
      // role из бэкапа как есть. Восстановление — действие только admin, так
      // что прямой эскалации нет, но подсунутый (скомпрометированный или
      // отредактированный вручную «для отладки») файл бэкапа мог занести
      // пользователя с нестандартной ролью, на которую код в остальных
      // местах не рассчитан. Прогоняем через тот же ROLES whitelist.
      if (req.body.users && Array.isArray(req.body.users) && req.body.users.length) {
        const ROLES = ['viewer', 'operator', 'admin'];
        const validUsers = req.body.users.filter(u => u.username && u.password && ROLES.includes(u.role));
        // Если из присланного списка НИ ОДНА запись не прошла проверку —
        // это почти наверняка несовместимый/битый формат бэкапа, а не
        // намеренно пустой список пользователей. Не трогаем таблицу вообще,
        // а не удаляем всех и вставляем ноль — именно это раньше и
        // приводило к полной блокировке входа.
        if (validUsers.length) {
          txRun('DELETE FROM users');
          for (const u of validUsers) {
            // salt может отсутствовать в бэкапах, снятых до перехода на
            // соль-на-пользователя (см. auth/crypto.js) — восстанавливаем как
            // есть (''), findUserByCredentials() при следующем входе
            // распознает старый формат и сам обновит соль.
            const ok = txRun('INSERT OR REPLACE INTO users (id,username,password,salt,role,must_change_password,created_at) VALUES (?,?,?,?,?,?,?)',
              [u.id||null, u.username, u.password, u.salt||'', u.role, u.must_change_password||0, u.created_at||new Date().toISOString()]);
            if (ok) usersInserted++;
          }
        } else {
          console.warn(`[restore] В бэкапе ${req.body.users.length} записей users, но ни одна не прошла валидацию — таблица users не тронута`);
        }
      }
      db.run('COMMIT');
      saveDb();
      // Invalidate all sessions after restore — DB state changed, force re-login
      try { db.run('DELETE FROM sessions'); saveDb(); } catch(e) {}
      res.json({
        ok: true,
        restored: { orgs: orgsInserted, requests: requestsInserted, users: usersInserted },
        files: { restored: filesRestored, missing: filesMissing },
      });
    } catch(e) {
      try { db.run('ROLLBACK'); } catch(e2) {}
      console.error('[restore] Ошибка, откат транзакции:', e.message);
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
