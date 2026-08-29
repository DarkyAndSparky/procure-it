/**
 * server/routes/filials.routes.js
 *
 * Фаза 1 рефакторинга: роуты филиалов, вынесенные из index.js
 * без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth, requireLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createFilialSchema, updateFilialSchema, closeFilialSchema } = require('../validation/schemas');

const router = express.Router();

// INFRA-7: раньше открыт без авторизации — отдаёт адреса филиалов.
router.get('/', requireLogin, (req, res) => {
  res.json(db.config.getFilials(req.query.system === 'true'));
});
router.post('/', requireAuth, validate(createFilialSchema), (req, res) => {
  try { res.json(db.config.createFilial(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id', requireAuth, validate(updateFilialSchema), (req, res) => {
  try { res.json(db.config.updateFilial(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/close', requireAuth, validate(closeFilialSchema), (req, res) => {
  try { res.json(db.config.closeFilial(req.params.id, req.body.changedBy||'admin')); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
