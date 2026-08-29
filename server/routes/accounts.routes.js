/**
 * server/routes/accounts.routes.js
 *
 * Фаза 3 рефакторинга: роуты учётных записей, вынесенные из index.js
 * без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createAccountSchema, updateAccountSchema } = require('../validation/schemas');

const router = express.Router();

function canViewSecrets(user) {
  return user?.role === 'admin' || !!user?.can_view_accounts;
}

router.get('/', requireAuth, (req, res) => {
  const accounts = db.config.getAccounts();
  if (canViewSecrets(req.currentUser)) return res.json(accounts);
  // SEC-4: без разрешения не отдаём логин/пароль — только метаданные
  // и признак того, что они заполнены (чтобы UI мог показать замочек).
  res.json(accounts.map(a => {
    const { login, password, ...rest } = a;
    return { ...rest, has_login: !!login, has_password: !!password };
  }));
});
router.post('/', requireAuth, validate(createAccountSchema), (req, res) => {
  try { res.json(db.config.addAccount(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id', requireAuth, validate(updateAccountSchema), (req, res) => {
  let { name, login, password, note, category } = req.body;
  if (!canViewSecrets(req.currentUser)) {
    // Без разрешения на просмотр пароль/логин не менять вслепую —
    // иначе можно случайно затереть секрет, которого сам не видел.
    login = undefined; password = undefined;
  }
  try { res.json(db.config.updateAccount(req.params.id, { name, login, password, note, category })); }
  catch(e) { res.status(404).json({ error: e.message }); }
});
router.delete('/:id', requireAuth, (req, res) => {
  try { res.json(db.config.deleteAccount(req.params.id)); }
  catch(e) { res.status(404).json({ error: e.message }); }
});

module.exports = router;
