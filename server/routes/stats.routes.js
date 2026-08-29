/**
 * server/routes/stats.routes.js
 *
 * Фаза 4c рефакторинга: роут статистики, вынесенный из index.js без
 * изменения поведения.
 */
'use strict';

const express = require('express');
const statsRepo = require('../repositories/stats.repo');

const router = express.Router();

// INFRA-7: намеренно оставлено публичным (без requireLogin) — используется
// публичным dashboard-экраном (не входит в _protected в router.js, задуман
// доступным без логина). Проверено при аудите, не оставлено по ошибке.
router.get('/', (req, res) => {
  res.json(statsRepo.getStats());
});

module.exports = router;
