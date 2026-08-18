const express = require('express');
const router = express.Router();

const { query, run } = require('../db/connection');
const { operatorOrAdmin } = require('../auth/middleware');

router.get('/orgs', (req, res) => {
  res.json(query('SELECT * FROM orgs ORDER BY short'));
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

router.post('/orgs', operatorOrAdmin, (req, res) => {
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
  res.json(query('SELECT * FROM orgs WHERE id=?', [id])[0]);
});

router.put('/orgs/:id', operatorOrAdmin, (req, res) => {
  const { full, short, prefix='', signatory='', contract='', address='', supplier='', stamp='1', folder='' } = req.body;
  if (!full || !short) return res.status(400).json({ error: 'Обязательные поля: full, short' });
  const exists = query('SELECT id FROM orgs WHERE id=?', [req.params.id])[0];
  if (!exists) return res.status(404).json({ error: 'Организация не найдена' });
  const dup = findDuplicateOrg(short, folder, req.params.id);
  if (dup) return res.status(409).json({ error: `Конфликт с существующей организацией «${dup.full}» — совпадает короткое название или папка для файлов` });
  run('UPDATE orgs SET full=?,short=?,prefix=?,signatory=?,contract=?,address=?,supplier=?,stamp=?,folder=? WHERE id=?',
    [full, short, prefix, signatory, contract, address, supplier, stamp, folder, req.params.id]);
  res.json(query('SELECT * FROM orgs WHERE id=?', [req.params.id])[0]);
});

// Импорт организаций списком — каждая строка результат парсинга на клиенте
// (см. public/js/registry.js parseOrgImportText). Сервер здесь — источник
// истины по дублям (переиспользует findDuplicateOrg), поэтому построчно
// вставляет валидные записи и построчно же отчитывается об ошибках, а не
// падает всей пачкой при первом же конфликте.
router.post('/orgs/bulk', operatorOrAdmin, (req, res) => {
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
    results.push({ i, status: 'added', full, short, org: query('SELECT * FROM orgs WHERE id=?', [id])[0] });
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
  run('DELETE FROM orgs WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
