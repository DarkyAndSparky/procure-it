/**
 * server/routes/assets.routes.js
 *
 * Фаза 4 рефакторинга: роуты активов, вынесенные из index.js без
 * изменения поведения.
 */
'use strict';

const express = require('express');
const assetsRepo = require('../repositories/assets.repo');
const { requireAuth, requireLogin, changedBy } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createAssetSchema, updateAssetSchema, moveAssetSchema,
        bulkMoveAssetsSchema, bulkAssignInvSchema } = require('../validation/schemas');

const router = express.Router();

// INFRA-7: раньше эти три роута были без requireAuth — активы (включая
// серийные номера, ответственных, локации) отдавались без авторизации
// любому, кто достучится до API, хотя фронтенд прячет вкладки os/small/infra
// за логином (см. router.js, _protected). Тот же класс проблемы, что нашли
// в procure-it на /system-info: защита была только в UI, не в API.
router.get('/', requireLogin, (req, res) => {
  res.json(assetsRepo.listAssets(req.query));
});

router.get('/search', requireLogin, (req, res) => {
  if (req.query.q === undefined) return res.status(400).json({ error: 'q required' });
  res.json(assetsRepo.searchAssets(req.query.q));
});

router.get('/:id', requireLogin, (req, res) => {
  const asset = assetsRepo.getAssetById(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });
  res.json(asset);
});

router.post('/', requireAuth, validate(createAssetSchema), (req, res) => {
  try { res.json(assetsRepo.createAsset(req.body, changedBy(req))); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requireAuth, validate(updateAssetSchema), (req, res) => {
  try { res.json(assetsRepo.updateAsset(req.params.id, req.body, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

router.delete('/:id', requireAuth, (req, res) => {
  try { res.json(assetsRepo.retireAsset(req.params.id, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

router.post('/:id/move', requireAuth, validate(moveAssetSchema), (req, res) => {
  try { res.json(assetsRepo.moveAsset(req.params.id, req.body, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

router.post('/bulk-move', requireAuth, validate(bulkMoveAssetsSchema), (req, res) => {
  try { res.json(assetsRepo.bulkMoveAssets(req.body, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

router.post('/bulk-assign-inv', requireAuth, validate(bulkAssignInvSchema), (req, res) => {
  try { res.json(assetsRepo.bulkAssignInv(req.body, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 400).json({ error: e.message }); }
});

module.exports = router;
