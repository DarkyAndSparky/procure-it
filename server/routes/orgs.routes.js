/**
 * server/routes/orgs.routes.js
 *
 * Фаза 1 рефакторинга: роуты организаций, вынесенные из index.js
 * без изменения поведения. db — через require('../database'),
 * чтобы не ломать jest.mock('../server/database', ...) в тестах.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth, requireLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createOrgSchema, updateOrgSchema, renameOrgSchema, liquidateOrgSchema,
        addInvRuleSchema, toggleInvRuleSchema, renameInvRuleSchema,
        deleteInvRuleForceSchema } = require('../validation/schemas');

const router = express.Router();

// INFRA-7: все три GET раньше были без requireAuth — включая правила
// инвентарных номеров (org.inv_rules), которые определяют логику
// нумерации активов.
router.get('/', requireLogin, (req, res) => {
  res.json(db.config.getOrgs(req.query.system === 'true'));
});
router.get('/:id', requireLogin, (req, res) => {
  const org = db.config.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Не найдено' });
  res.json(org);
});
router.post('/', requireAuth, validate(createOrgSchema), (req, res) => {
  try { res.json(db.config.createOrg(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id', requireAuth, validate(updateOrgSchema), (req, res) => {
  try { res.json(db.config.updateOrg(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/rename', requireAuth, validate(renameOrgSchema), (req, res) => {
  const { newName, changedBy } = req.body;
  try { res.json(db.config.renameOrg(req.params.id, newName, changedBy||'admin')); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/liquidate', requireAuth, validate(liquidateOrgSchema), (req, res) => {
  const { targetOrgId, changedBy, renumberInv } = req.body;
  try { res.json(db.config.liquidateOrg(req.params.id, targetOrgId, changedBy||'admin', !!renumberInv)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.get('/:id/inv-rules', requireLogin, (req, res) => {
  const org = db.config.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Не найдено' });
  res.json(org.inv_rules || []);
});
router.post('/:id/inv-rules', requireAuth, validate(addInvRuleSchema), (req, res) => {
  try { res.json(db.config.addInvRule(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.patch('/:id/inv-rules/:typeCode', requireAuth, validate(toggleInvRuleSchema), (req, res) => {
  try { res.json(db.config.toggleInvRule(req.params.id, req.params.typeCode, req.body.active)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id/inv-rules/:typeCode', requireAuth, validate(renameInvRuleSchema), (req, res) => {
  try { res.json(db.config.renameInvRule(req.params.id, req.params.typeCode, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.delete('/:id/inv-rules/:typeCode', requireAuth, (req, res) => {
  try { res.json(db.config.deleteInvRule(req.params.id, req.params.typeCode)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/inv-rules/:typeCode/delete-force', requireAuth, validate(deleteInvRuleForceSchema), (req, res) => {
  const { action, targetTypeCode } = req.body;
  try { res.json(db.config.deleteInvRuleForce(req.params.id, req.params.typeCode, action, targetTypeCode)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.get('/:id/inv-next', requireAuth, (req, res) => {
  if (!req.query.type) return res.status(400).json({ error: 'type required' });
  try { res.json(db.config.nextInv(req.params.id, req.query.type)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
