/**
 * server/routes/inv.routes.js
 *
 * Фаза 4b рефакторинга (добивка тонких обёрток после ядра assets/history):
 * инвентарные номера, вынесенные из index.js без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth, requireLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { reserveInvSchema } = require('../validation/schemas');

const router = express.Router();

// INFRA-7: раньше открыты без авторизации — коды организаций/типов и
// генератор следующего инв. номера использовались только из-под логина
// на фронтенде (inv-generator.js), но API это не проверял.
router.get('/codes', requireLogin, (req, res) => {
  res.json({ orgs: db.ORG_CODES || {}, types: db.TYPE_CODES || {} });
});

router.get('/next', requireLogin, (req, res) => {
  const { org_id, org, type } = req.query;
  if (!type) return res.status(400).json({ error: 'type required' });
  let orgId = org_id;
  if (!orgId && org) {
    const found = db.config.getOrgs().find(o => o.short_code === org.toUpperCase());
    if (!found) return res.status(404).json({ error: `Организация ${org} не найдена` });
    orgId = found.id;
  }
  if (!orgId) return res.status(400).json({ error: 'org_id or org required' });
  try { res.json(db.config.nextInv(orgId, type, { reserve: false })); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.post('/reserve', requireAuth, validate(reserveInvSchema), (req, res) => {
  const { org_id, org, type } = req.body;
  let orgId = org_id;
  if (!orgId && org) {
    const found = db.config.getOrgs().find(o => o.short_code === (org||'').toUpperCase());
    if (!found) return res.status(404).json({ error: `Организация ${org} не найдена` });
    orgId = found.id;
  }
  if (!orgId) return res.status(400).json({ error: 'org_id or org required' });
  try { const result = db.config.nextInv(orgId, type, { reserve: true }); res.json({ ok:true, ...result }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
