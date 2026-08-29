/**
 * server/routes/employees.routes.js
 *
 * Фаза 3 рефакторинга: чистый CRUD сотрудников.
 * Фаза 4: reassign-assets добавлен сюда же — он трогает assets (в SQLite
 * с Фазы 7c-8b), логика вынесена в assets.repo.js::reassignEmployeeAssets.
 */
'use strict';

const express = require('express');
const db = require('../database');
const assetsRepo = require('../repositories/assets.repo');
const { requireAuth, changedBy } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createEmployeeSchema, updateEmployeeSchema, reassignAssetsSchema } = require('../validation/schemas');

const router = express.Router();

router.get('/', (req, res) => {
  if (!db.getUser(req.headers['x-user-id'])?.active)
    return res.status(401).json({ error: 'Unauthorized' });
  const { q, active } = req.query;
  if (q) return res.json(db.searchEmployees(q));
  res.json(db.getEmployees(active !== 'false'));
});

router.get('/:id', (req, res) => {
  if (!db.getUser(req.headers['x-user-id'])?.active)
    return res.status(401).json({ error: 'Unauthorized' });
  const emp = db.getEmployee(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Не найден' });
  res.json(emp);
});

router.post('/', requireAuth, validate(createEmployeeSchema), (req, res) => {
  try { res.json(db.createEmployee(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requireAuth, validate(updateEmployeeSchema), (req, res) => {
  try { res.json(db.updateEmployee(req.params.id, req.body)); }
  catch(e) { res.status(e.message.includes('не найден') ? 404 : 400).json({ error: e.message }); }
});

router.delete('/:id', requireAuth, (req, res) => {
  try { res.json(db.deleteEmployee(req.params.id)); }
  catch(e) { res.status(e.message.includes('не найден') ? 404 : 409).json({ error: e.message }); }
});

router.post('/:id/reassign-assets', requireAuth, validate(reassignAssetsSchema), (req, res) => {
  try {
    const { to_employee_id } = req.body;
    res.json(assetsRepo.reassignEmployeeAssets(req.params.id, to_employee_id, changedBy(req)));
  } catch(e) {
    res.status(e.notFound ? 404 : 400).json({ error: e.message });
  }
});

module.exports = router;
