/**
 * server/routes/csv.routes.js
 *
 * Фаза 4d рефакторинга: роуты CSV-экспорта/импорта и импорта истории,
 * вынесенные из index.js без изменения поведения. Пути смешанные
 * (/api/export/csv, /api/import/*), поэтому монтируется на /api.
 */
'use strict';

const express = require('express');
const csvRepo = require('../repositories/csv.repo');
const { requireAuth, changedBy } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { importHistorySchema, importCsvPreviewSchema, importCsvSchema } = require('../validation/schemas');

const router = express.Router();

// SEC-8 (заодно): экспорт был без requireAuth — любой мог скачать весь
// список активов компании без входа в систему. Остальные /api/export-*
// и /api/*-роуты везде требуют авторизации, здесь явно упустили.
router.get('/export/csv', requireAuth, (req, res) => {
  const { tab } = req.query;
  const csv = csvRepo.exportCsv(tab);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="IT_assets${tab?'_'+tab:''}.csv"`);
  res.send(csv);
});

router.post('/import/history', requireAuth, validate(importHistorySchema), (req, res) => {
  try { res.json(csvRepo.importHistory(req.body.rows, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

router.post('/import/csv/preview', requireAuth, validate(importCsvPreviewSchema), (req, res) => {
  try { res.json(csvRepo.previewCsvImport(req.body.rows)); }
  catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

router.post('/import/csv', requireAuth, validate(importCsvSchema), (req, res) => {
  try {
    const { rows, create_orgs, create_employees } = req.body;
    res.json(csvRepo.importCsv(rows, { create_orgs, create_employees }, changedBy(req)));
  } catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

module.exports = router;
