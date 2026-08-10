const express = require('express');
const router = express.Router();

const { query, run } = require('../db/connection');
const { operatorOrAdmin } = require('../auth/middleware');

router.get('/orgs', (req, res) => {
  res.json(query('SELECT * FROM orgs ORDER BY short'));
});

router.post('/orgs', operatorOrAdmin, (req, res) => {
  const { full, short, prefix='', signatory='', contract='', address='', supplier='', stamp='1', folder='' } = req.body;
  if (!full || !short) return res.status(400).json({ error: 'Обязательные поля: full, short' });
  // Префикс больше не участвует в номере спецификации (тот теперь берётся из
  // типа документа — П/Р/М/С), поле оставлено в схеме БД для обратной
  // совместимости, но в UI не запрашивается.
  const id = Date.now().toString();
  run('INSERT INTO orgs (id,full,short,prefix,signatory,contract,address,supplier,stamp,folder) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, full, short, prefix, signatory, contract, address, supplier, stamp, folder]);
  res.json(query('SELECT * FROM orgs WHERE id=?', [id])[0]);
});

router.put('/orgs/:id', operatorOrAdmin, (req, res) => {
  const { full, short, prefix='', signatory='', contract='', address='', supplier='', stamp='1', folder='' } = req.body;
  if (!full || !short) return res.status(400).json({ error: 'Обязательные поля: full, short' });
  const exists = query('SELECT id FROM orgs WHERE id=?', [req.params.id])[0];
  if (!exists) return res.status(404).json({ error: 'Организация не найдена' });
  run('UPDATE orgs SET full=?,short=?,prefix=?,signatory=?,contract=?,address=?,supplier=?,stamp=?,folder=? WHERE id=?',
    [full, short, prefix, signatory, contract, address, supplier, stamp, folder, req.params.id]);
  res.json(query('SELECT * FROM orgs WHERE id=?', [req.params.id])[0]);
});

router.delete('/orgs/:id', operatorOrAdmin, (req, res) => {
  const used = query('SELECT COUNT(*) as c FROM requests WHERE org_id=?', [req.params.id]);
  if ((used[0]?.c || 0) > 0) return res.status(400).json({ error: 'Нельзя удалить — есть заявки' });
  run('DELETE FROM orgs WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
