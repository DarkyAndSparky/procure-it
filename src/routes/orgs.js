const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { query, run } = require('../db/connection');
const { operatorOrAdmin } = require('../auth/middleware');
const { APPROVAL_DIR } = require('../config');

// ВАЖНО: этот роутер монтируется в server.js ДО общего express.json() —
// как и routes/files.js, из-за загрузки approval-pdf (см. ниже), которой
// нужен лимит больше дефолтного. Из-за этого КАЖДЫЙ роут здесь, которому
// нужен распарсенный body (POST/PUT), обязан сам объявить свой
// express.json(...) — иначе req.body будет undefined, т.к. общий парсер
// в цепочку уже не попадёт (см. подробный комментарий у Body parsers в
// server.js про то, что реально работает только ПЕРВЫЙ парсер, тронувший
// поток запроса).
//
// Та же защита в глубину, что и в routes/files.js — id организации всегда
// randomUUID() при создании через API, но восстановленная из старого/чужого
// бэкапа запись теоретически могла сохранить произвольную строку, а мы
// используем id для имени файла на диске.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
function requireSafeId(req, res, next) {
  if (!SAFE_ID.test(req.params.id)) {
    return res.status(400).json({ error: 'Некорректный идентификатор организации' });
  }
  next();
}

// approval_pdf хранит СЛУЖЕБНОЕ имя файла на диске (см. approval-pdf роуты
// ниже) — тот же принцип, что у signed_spec_pdf/invoice_file в
// db/connection.js#rowToRequest: клиенту нужен только факт «файл есть»,
// а не путь на сервере, поэтому наружу отдаём флаг-заглушку, а не реальное
// имя файла. (Реальный impact утечки минимален — имя файла и так равно
// `${id}.pdf`, а id организации публичен — но лучше не заводить исключение
// из общего правила проекта.)
function maskOrg(o) {
  if (!o) return o;
  return { ...o, approval_pdf: o.approval_pdf ? '__has_pdf__' : '' };
}

router.get('/orgs', (req, res) => {
  res.json(query('SELECT * FROM orgs ORDER BY short').map(maskOrg));
});

// SQLite's built-in NOCASE collation only folds ASCII A-Z — кириллица «ЛД»
// и «лд» для него РАЗНЫЕ строки, так что полагаться на COLLATE NOCASE в
// UNIQUE-индексе для проверки дублей нельзя (короткие названия чаще всего
// как раз кириллица). Поэтому сравнение регистронезависимо — на уровне
// приложения через JS toLowerCase(), который Unicode понимает корректно.
//
// Проверяем не только короткое название, но и ФАКТИЧЕСКУЮ папку раскладки
// файлов (folder || short — см. fileLayoutService.js) — у двух организаций
// может быть разный short, но одинаковый folder, и тогда они физически
// разложатся в одну и ту же папку на диске.
function findDuplicateOrg(short, folder, excludeId) {
  const normShort  = String(short || '').trim().toLowerCase();
  const normFolder = String(folder || short || '').trim().toLowerCase();
  if (!normShort && !normFolder) return null;
  return query('SELECT id, full, short, folder FROM orgs').find(o => {
    if (o.id === excludeId) return false;
    const oShort  = String(o.short || '').trim().toLowerCase();
    const oFolder = String(o.folder || o.short || '').trim().toLowerCase();
    return (normShort && oShort === normShort) || (normFolder && oFolder === normFolder);
  }) || null;
}

router.post('/orgs', operatorOrAdmin, express.json({ limit: '15mb' }), (req, res) => {
  const { full, short, prefix='', signatory='', contract='', address='', supplier='', stamp='1', folder='' } = req.body;
  if (!full || !short) return res.status(400).json({ error: 'Обязательные поля: full, short' });
  // Дубли короткого названия/папки путают и нумерацию, и раскладку файлов —
  // организации попадали бы в одну и ту же папку на диске.
  const dup = findDuplicateOrg(short, folder, null);
  if (dup) return res.status(409).json({ error: `Конфликт с существующей организацией «${dup.full}» — совпадает короткое название или папка для файлов` });
  // Префикс больше не участвует в номере спецификации (тот теперь берётся из
  // типа документа — П/Р/М/С), поле оставлено в схеме БД для обратной
  // совместимости, но в UI не запрашивается.
  // Уязвимость (найдена при аудите): id раньше был Date.now() — при двух
  // запросах на создание в одну и ту же миллисекунду (например, два bulk-
  // импорта параллельно, или просто быстрый двойной клик) получались
  // одинаковые id и INSERT падал на PRIMARY KEY. randomUUID() эту гонку
  // исключает структурно, а не понижением вероятности.
  const id = require('crypto').randomUUID();
  run('INSERT INTO orgs (id,full,short,prefix,signatory,contract,address,supplier,stamp,folder) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, full, short, prefix, signatory, contract, address, supplier, stamp, folder]);
  res.json(maskOrg(query('SELECT * FROM orgs WHERE id=?', [id])[0]));
});

router.put('/orgs/:id', operatorOrAdmin, express.json({ limit: '15mb' }), (req, res) => {
  const { full, short, prefix='', signatory='', contract='', address='', supplier='', stamp='1', folder='' } = req.body;
  if (!full || !short) return res.status(400).json({ error: 'Обязательные поля: full, short' });
  const exists = query('SELECT id FROM orgs WHERE id=?', [req.params.id])[0];
  if (!exists) return res.status(404).json({ error: 'Организация не найдена' });
  const dup = findDuplicateOrg(short, folder, req.params.id);
  if (dup) return res.status(409).json({ error: `Конфликт с существующей организацией «${dup.full}» — совпадает короткое название или папка для файлов` });
  run('UPDATE orgs SET full=?,short=?,prefix=?,signatory=?,contract=?,address=?,supplier=?,stamp=?,folder=? WHERE id=?',
    [full, short, prefix, signatory, contract, address, supplier, stamp, folder, req.params.id]);
  res.json(maskOrg(query('SELECT * FROM orgs WHERE id=?', [req.params.id])[0]));
});

// Импорт организаций списком — каждая строка результат парсинга на клиенте
// (см. public/js/registry.js parseOrgImportText). Сервер здесь — источник
// истины по дублям (переиспользует findDuplicateOrg), поэтому построчно
// вставляет валидные записи и построчно же отчитывается об ошибках, а не
// падает всей пачкой при первом же конфликте.
router.post('/orgs/bulk', operatorOrAdmin, express.json({ limit: '15mb' }), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Пустой список' });

  const results = [];
  // Дубли внутри самого импортируемого списка (не только против БД) —
  // накапливаем short/folder уже принятых строк по ходу обработки.
  const seenShort = new Map();
  const seenFolder = new Map();

  rows.forEach((row, i) => {
    const full = String(row.full || '').trim();
    const short = String(row.short || '').trim();
    const signatory = String(row.signatory || '').trim();
    const contract = String(row.contract || '').trim();
    const address = String(row.address || '').trim();
    const folder = String(row.folder || '').trim();

    if (!full || !short) {
      results.push({ i, status: 'error', full, short, error: 'Не заполнены обязательные поля (полное/короткое название)' });
      return;
    }

    const normShort = short.toLowerCase();
    const normFolder = (folder || short).toLowerCase();

    const dup = findDuplicateOrg(short, folder, null);
    if (dup) {
      results.push({ i, status: 'skipped', full, short, error: `Уже есть в системе: «${dup.full}»` });
      return;
    }
    if (seenShort.has(normShort) || seenFolder.has(normFolder)) {
      const clash = seenShort.get(normShort) || seenFolder.get(normFolder);
      results.push({ i, status: 'skipped', full, short, error: `Дубль внутри списка (строка ${clash + 1})` });
      return;
    }

    const id = require('crypto').randomUUID();
    run('INSERT INTO orgs (id,full,short,prefix,signatory,contract,address,supplier,stamp,folder) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, full, short, '', signatory, contract, address, '', '1', folder]);
    seenShort.set(normShort, i);
    seenFolder.set(normFolder, i);
    results.push({ i, status: 'added', full, short, org: maskOrg(query('SELECT * FROM orgs WHERE id=?', [id])[0]) });
  });

  res.json({
    added: results.filter(r => r.status === 'added').length,
    skipped: results.filter(r => r.status !== 'added').length,
    results,
  });
});

router.delete('/orgs/:id', operatorOrAdmin, (req, res) => {
  const used = query('SELECT COUNT(*) as c FROM requests WHERE org_id=?', [req.params.id]);
  if ((used[0]?.c || 0) > 0) return res.status(400).json({ error: 'Нельзя удалить — есть заявки' });
  // Подчищаем файл листа согласования с диска, чтобы не копить сироты в
  // data/contract_approvals/ — сама запись organization уже точно исчезнет,
  // и никакой другой код больше не сможет сослаться на этот файл.
  const row = query('SELECT approval_pdf FROM orgs WHERE id=?', [req.params.id])[0];
  if (row?.approval_pdf) {
    try { fs.unlinkSync(path.join(APPROVAL_DIR, path.basename(row.approval_pdf))); }
    catch(e) { console.warn('[orgs] Не удалось удалить файл листа согласования при удалении организации:', e.message); }
  }
  run('DELETE FROM orgs WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ── Лист согласования договора поставки (PDF) ──────────────────────────────
// Один файл на организацию — тот же скан прикладывается ко всем заявкам,
// у которых на странице спецификации включена галочка «печатать вместе с
// листом согласования».
// Upload: POST /api/orgs/:id/approval-pdf  { file: base64, name }
router.post('/orgs/:id/approval-pdf', operatorOrAdmin, requireSafeId, express.json({ limit: '20mb' }), (req, res) => {
  try {
    const { file, name } = req.body;
    if (!file || !file.startsWith('data:application/pdf')) {
      return res.status(400).json({ error: 'Ожидается PDF в формате base64' });
    }
    const org = query('SELECT id FROM orgs WHERE id=?', [req.params.id])[0];
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });

    // Храним на диске, а не в БД — тот же приём, что для signed_spec_pdf/
    // invoice_file (см. routes/files.js), чтобы не раздувать SQLite бинарными
    // данными.
    const fname = `${req.params.id}.pdf`;
    const buf   = Buffer.from(file.replace(/^data:application\/pdf;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(APPROVAL_DIR, fname), buf);

    const originalName = (name || '').trim().slice(0, 200);
    run('UPDATE orgs SET approval_pdf=?, approval_pdf_name=? WHERE id=?', [fname, originalName, req.params.id]);
    res.json(maskOrg(query('SELECT * FROM orgs WHERE id=?', [req.params.id])[0]));
  } catch(e) {
    console.error('[orgs] Ошибка загрузки листа согласования:', e.message);
    res.status(500).json({ error: 'Не удалось сохранить файл. Попробуйте ещё раз.' });
  }
});

// Download/view: GET /api/orgs/:id/approval-pdf
// Без operatorOrAdmin — доступно и viewer'у, потому что печать спецификации
// (включая лист согласования) не ограничена ролью, а инлайновый просмотр
// используется в т.ч. для параллельной печати из отдельной вкладки.
router.get('/orgs/:id/approval-pdf', requireSafeId, (req, res) => {
  try {
    const row = query('SELECT approval_pdf, approval_pdf_name, short FROM orgs WHERE id=?', [req.params.id])[0];
    if (!row?.approval_pdf) return res.status(404).json({ error: 'Лист согласования не прикреплён' });
    const fpath = path.join(APPROVAL_DIR, path.basename(row.approval_pdf));
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Файл не найден на диске' });
    const dlName = row.approval_pdf_name || `${row.short}_лист_согласования.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    // inline (не attachment) — открывается в новой вкладке во встроенном PDF-
    // просмотрщике браузера, откуда пользователь и печатает (см. printSpec()
    // в public/js/request-detail.js).
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(dlName)}`);
    res.send(fs.readFileSync(fpath));
  } catch(e) {
    console.error('[orgs] Ошибка скачивания листа согласования:', e.message);
    res.status(500).json({ error: 'Не удалось получить файл. Попробуйте ещё раз.' });
  }
});

// Delete: DELETE /api/orgs/:id/approval-pdf
router.delete('/orgs/:id/approval-pdf', operatorOrAdmin, requireSafeId, (req, res) => {
  try {
    const row = query('SELECT approval_pdf FROM orgs WHERE id=?', [req.params.id])[0];
    if (!row) return res.status(404).json({ error: 'Организация не найдена' });
    if (row.approval_pdf) {
      try { fs.unlinkSync(path.join(APPROVAL_DIR, path.basename(row.approval_pdf))); }
      catch(e) { console.warn('[orgs] Не удалось удалить файл листа согласования с диска:', e.message); }
    }
    run('UPDATE orgs SET approval_pdf=?, approval_pdf_name=? WHERE id=?', ['', '', req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    console.error('[orgs] Ошибка удаления листа согласования:', e.message);
    res.status(500).json({ error: 'Не удалось удалить файл. Попробуйте ещё раз.' });
  }
});

module.exports = router;
