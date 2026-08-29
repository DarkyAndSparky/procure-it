/**
 * server/routes/config.routes.js
 *
 * Фаза 4b рефакторинга: экспорт/импорт конфига, вынесенный из index.js
 * без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { importDiffSchema, importApplySchema } = require('../validation/schemas');

const router = express.Router();

router.get('/export', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=config.json');
  res.send(JSON.stringify(db.config.exportConfig(), null, 2));
});

router.post('/import/diff', requireAuth, validate(importDiffSchema), (req, res) => {
  try { res.json(db.config.diffConfig(req.body.config)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/import/apply', requireAuth, validate(importApplySchema), (req, res) => {
  const { clean, resolutions, incoming, changedBy } = req.body;
  try { res.json(db.config.applyImport(clean, resolutions, incoming, changedBy||'admin')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
