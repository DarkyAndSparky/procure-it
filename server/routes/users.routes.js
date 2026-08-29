/**
 * server/routes/users.routes.js
 *
 * Фаза 3 рефакторинга: роуты пользователей системы, вынесенные из index.js
 * без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { verifyPin, isEmpty } = require('../pin');
const DEFAULT_PINS = { 'sys-user-admin': 'admn0000' };
function effectiveRoleOf(user) {
  return (isEmpty(user.pin) && user.role !== 'viewer') ? 'viewer' : user.role;
}
function mustChangePin(user) {
  const def = DEFAULT_PINS[user.id];
  return def != null && verifyPin(def, user.pin);
}
const { requireAdmin } = require('../middleware/auth');
const { rateLimitLogin } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { createUserSchema, updateUserSchema } = require('../validation/schemas');

const router = express.Router();

router.get('/', (req, res) => {
  // Список пользователей (без PIN) — доступен всем залогиненным
  const userId = req.headers['x-user-id'];
  if (!db.getUser(userId)?.active) return res.status(401).json({ error: 'Unauthorized' });
  res.json(db.getUsers().map(u => ({ id:u.id, name:u.name, role:u.role, active:u.active, can_view_accounts:u.can_view_accounts })));
});

router.get('/list', (req, res) => {
  // Публичный список для экрана входа (только id + name + role)
  res.json(db.getUsers().map(u => ({ id:u.id, name:u.name, role:u.role })));
});

router.post('/auth', rateLimitLogin, (req, res) => {
  const { user_id, pin } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const user = db.authUser(user_id, pin || '');
  if (!user) return res.status(401).json({ error: 'Неверный PIN или пользователь не найден' });
  res.json({
    ok:true,
    user:{ id:user.id, name:user.name, role:effectiveRoleOf(user) },
    must_change_pin: mustChangePin(user)
  });
});

router.post('/login', rateLimitLogin, (req, res) => {
  const { login, password } = req.body || {};
  if (!login) return res.status(400).json({ error: 'login required' });
  const user = db.authByLogin(login, password || '');
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

  const isDefaultPin = mustChangePin(user);

  res.json({
    ok:true,
    user:{ id:user.id, name:user.name, role:effectiveRoleOf(user) },
    warn_default_pin: isDefaultPin, // legacy-поле, оставлено для старого фронта
    must_change_pin: isDefaultPin
  });
});

router.post('/', requireAdmin, validate(createUserSchema), (req, res) => {
  try { res.json(db.createUser(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requireAdmin, validate(updateUserSchema), (req, res) => {
  try { res.json(db.updateUser(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', requireAdmin, (req, res) => {
  try { res.json(db.deleteUser(req.params.id)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
