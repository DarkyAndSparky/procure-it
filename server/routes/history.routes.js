/**
 * server/routes/history.routes.js
 *
 * Фаза 4 рефакторинга: роут истории, вынесенный из index.js без
 * изменения поведения.
 */
'use strict';

const express = require('express');
const historyRepo = require('../repositories/history.repo');

const router = express.Router();

// INFRA-7: намеренно оставлено публичным (без requireLogin) — используется
// публичным dashboard-экраном (последние 10 записей, не входит в
// _protected в router.js). Полная вкладка "История" защищена на уровне UI;
// сам эндпоинт остаётся открытым по решению из аудита INFRA-7.
router.get('/', (req, res) => {
  res.json(historyRepo.listHistory(req.query));
});

module.exports = router;
