const express = require('express');
const router = express.Router();

const { getDb, query, run, rowToRequest, saveDb } = require('../db/connection');
const { auditLog } = require('../db/audit');
const { operatorOrAdmin } = require('../auth/middleware');
const { sendStatusWebhook } = require('../services/bitrixService');

const ALLOWED_STATUSES = ['new','ordered','partial','delivered','cancelled'];

// ── REQUESTS ──────────────────────────────────────────────────────────────────
router.get('/requests', (req, res) => {
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

router.get('/requests/:id', (req, res) => {
  const row = query('SELECT * FROM requests WHERE id=?', [req.params.id])[0];
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  res.json(rowToRequest(row)); // PDF served via /api/requests/:id/signed-spec
});

router.post('/requests', operatorOrAdmin, (req, res) => {
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
  if (r.status && !ALLOWED_STATUSES.includes(r.status)) r.status = 'new';
  // Guard against spec_num collisions — e.g. a stale client-side registry cache
  // suggesting a number that was already taken by another request in the meantime.
  if (r.specNum) {
    const dup = query('SELECT id FROM requests WHERE spec_num=?', [r.specNum])[0];
    if (dup) return res.status(409).json({ error: `Спецификация с номером «${r.specNum}» уже существует. Обновите страницу и попробуйте снова.` });
  }
  const ok = run(`INSERT INTO requests (id,spec_num,org_id,org_full,org_short,org_signatory,org_stamp,bitrix,name,mol,date,address,supplier,invoice_num,contract,status,comment,is_realization,delivery_cost,markup,total_purchase,total,positions,doc_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'', r.orgStamp !== undefined ? (r.orgStamp?'1':'0') : '1',
     r.bitrix||'', r.name, r.mol||'', r.date||'', r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
     r.status||'new', r.comment||'', r.isRealization?1:0,
     r.deliveryCost||0, (r.markup!==undefined&&r.markup!==null?r.markup:5), r.totalPurchase||0, r.total||0,
     JSON.stringify(r.positions||[]), r.docType || 'goods']);
  if (!ok) return res.status(500).json({ error: 'Не удалось сохранить заявку. Возможно, номер спецификации уже занят — обновите страницу и попробуйте снова.' });
  auditLog('CREATE', id, null, null, r.specNum, { name: r.name, org: r.orgShort });
  res.json(rowToRequest(query('SELECT * FROM requests WHERE id=?', [id])[0]));
});

router.put('/requests/:id', operatorOrAdmin, (req, res) => {
  const r = req.body;
  if (!r.name) return res.status(400).json({ error: 'Название обязательно' });
  if (r.positions && !Array.isArray(r.positions)) return res.status(400).json({ error: 'positions должен быть массивом' });
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

  // Guard against spec_num collisions with a DIFFERENT request
  if (r.specNum && r.specNum !== prev.spec_num) {
    const dup = query('SELECT id FROM requests WHERE spec_num=? AND id!=?', [r.specNum, req.params.id])[0];
    if (dup) return res.status(409).json({ error: `Спецификация с номером «${r.specNum}» уже существует. Обновите страницу и попробуйте снова.` });
  }

  const ok = run(`UPDATE requests SET spec_num=?,org_id=?,org_full=?,org_short=?,org_signatory=?,org_stamp=?,bitrix=?,name=?,mol=?,date=?,address=?,supplier=?,invoice_num=?,contract=?,status=?,comment=?,is_realization=?,delivery_cost=?,markup=?,total_purchase=?,total=?,positions=?,doc_type=?,updated_at=datetime('now') WHERE id=?`,
    [r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'', r.orgStamp !== undefined ? (r.orgStamp?'1':'0') : '1',
     r.bitrix||'', r.name, r.mol||'', r.date||'', r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
     r.status||'new', r.comment||'', r.isRealization?1:0,
     r.deliveryCost||0, (r.markup!==undefined&&r.markup!==null?r.markup:5), r.totalPurchase||0, r.total||0,
     JSON.stringify(r.positions||[]), r.docType || 'goods', req.params.id]);
  if (!ok) return res.status(500).json({ error: 'Не удалось сохранить заявку. Возможно, номер спецификации уже занят — обновите страницу и попробуйте снова.' });
  auditLog('UPDATE', req.params.id, 'request', null, r.specNum, { name: r.name, diff: diffFields });
  res.json(rowToRequest(query('SELECT * FROM requests WHERE id=?', [req.params.id])[0]));
});

router.patch('/requests/:id/status', operatorOrAdmin, (req, res) => {
  const { status } = req.body;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Недопустимый статус. Допустимые: ${ALLOWED_STATUSES.join(', ')}` });
  }
  const old = query('SELECT status, spec_num, name, org_short, total FROM requests WHERE id=?', [req.params.id])[0];
  if (!old) return res.status(404).json({ error: 'Заявка не найдена' });
  run("UPDATE requests SET status=?,updated_at=datetime('now') WHERE id=?", [status, req.params.id]);
  auditLog('STATUS', req.params.id, 'status', old.status, status, { specNum: old.spec_num });

  // Fire status webhook asynchronously — don't block response
  (async () => {
    try {
      const whRows = getDb().exec("SELECT value FROM settings WHERE key='statusWebhook'");
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
      await sendStatusWebhook(webhookUrl, payload);
    } catch(e) { console.warn('[statusWebhook]', e.message); }
  })();

  res.json({ ok: true });
});

router.delete('/requests/:id', operatorOrAdmin, (req, res) => {
  const old = query('SELECT spec_num, name FROM requests WHERE id=?', [req.params.id])[0];
  if (!old) return res.status(404).json({ error: 'Заявка не найдена' });
  run('DELETE FROM requests WHERE id=?', [req.params.id]);
  auditLog('DELETE', req.params.id, null, old.spec_num, null, { name: old.name });
  res.json({ ok: true });
});

// ── ADDRESSES / MOL ───────────────────────────────────────────────────────────
router.get('/mol', operatorOrAdmin, (req, res) => {
  const rows = query(`SELECT DISTINCT mol FROM requests WHERE mol != '' ORDER BY mol LIMIT 50`);
  res.json(rows.map(r => r.mol));
});

router.get('/addresses', operatorOrAdmin, (req, res) => {
  res.json(query('SELECT address FROM addresses ORDER BY used_at DESC LIMIT 30').map(r => r.address));
});

router.post('/addresses', operatorOrAdmin, (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  run(`INSERT INTO addresses (address, used_at) VALUES (?, datetime('now'))
       ON CONFLICT(address) DO UPDATE SET used_at=datetime('now')`, [address]);
  res.json({ ok: true });
});

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
router.get('/templates', operatorOrAdmin, (req, res) => {
  res.json(query('SELECT * FROM templates ORDER BY created_at DESC')
    .map(r => ({ ...r, positions: JSON.parse(r.positions || '[]') })));
});

router.post('/templates', operatorOrAdmin, (req, res) => {
  const { name, positions=[] } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  db.run('INSERT INTO templates (name, positions) VALUES (?,?)', [name, JSON.stringify(positions)]);
  saveDb();
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  res.json({ id, name, positions });
});

router.delete('/templates/:id', operatorOrAdmin, (req, res) => {
  run('DELETE FROM templates WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
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

module.exports = router;
