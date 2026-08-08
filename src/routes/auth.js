const express = require('express');
const router = express.Router();

const { getDb, saveDb, run } = require('../db/connection');
const { getUsers, findUserByCredentials } = require('../auth/users');
const { sessionCreate, sessionDelete, sessionGetUser } = require('../auth/sessions');
const { generateToken, hashPassword } = require('../auth/crypto');
const { adminOnly } = require('../auth/middleware');
const { LEGACY_PASSWORD } = require('../config');

// strictLimiter применяется на login/change-password (передаётся из server.js при монтировании)
module.exports = (strictLimiter) => {
  router.get('/auth/status', (req, res) => {
    const token = req.headers['x-auth-token'] || (req.cookies && req.cookies['auth-token']);
    const user  = token ? sessionGetUser(token) : null;
    const users = getUsers();
    res.json({
      authEnabled:        true,
      authenticated:      !!user,
      role:               user?.role || 'viewer',
      username:           user?.username || null,
      mustChangePassword: user?.mustChangePassword || false,
      hasUsers:           users.length > 0 || !!LEGACY_PASSWORD,
      viewerAllowed:      true,
    });
  });

  router.post('/auth/login', strictLimiter, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
    const user = findUserByCredentials(username, password);
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
    const token = generateToken();
    sessionCreate(token, user.id);
    res.json({ ok: true, token, role: user.role, username: user.username, mustChangePassword: user.mustChangePassword });
  });

  router.post('/auth/logout', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) sessionDelete(token);
    res.json({ ok: true });
  });

  // Self-service password change (any authenticated user, for their own account)
  router.post('/auth/change-password', strictLimiter, (req, res) => {
    const token = req.headers['x-auth-token'];
    const user  = token ? sessionGetUser(token) : null;
    if (!user || !user.id) return res.status(401).json({ error: 'Не авторизован' });
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'Укажите новый пароль' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Новый пароль должен быть минимум 6 символов' });
    // При принудительной смене (временный пароль) текущий пароль не спрашиваем —
    // пользователь только что ввёл его при входе, повторный запрос избыточен.
    // В остальных случаях (добровольная смена пароля) текущий пароль обязателен
    // и проверяется как раньше.
    if (!user.mustChangePassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Укажите текущий пароль' });
      const currentHash = hashPassword(currentPassword);
      const check = getDb().exec('SELECT id FROM users WHERE id=? AND password=?', [user.id, currentHash]);
      if (!check[0]?.values?.length) return res.status(401).json({ error: 'Текущий пароль неверен' });
    }
    run('UPDATE users SET password=?, must_change_password=0 WHERE id=?', [hashPassword(newPassword), user.id]);
    saveDb();
    res.json({ ok: true });
  });

  // ── Users API (admin only) ──────────────────────────────────────────────────
  router.get('/users', adminOnly, (req, res) => {
    res.json(getUsers());
  });

  router.post('/users', adminOnly, (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
    const ROLES = ['viewer', 'operator', 'admin'];
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Роль должна быть: ${ROLES.join(', ')}` });
    try {
      const hash = hashPassword(password);
      run('INSERT INTO users (username, password, role) VALUES (?,?,?)', [username, hash, role]);
      saveDb();
      res.json({ ok: true });
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Пользователь уже существует' });
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/users/:id', adminOnly, (req, res) => {
    const { password, role } = req.body;
    const ROLES = ['viewer', 'operator', 'admin'];
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: `Недопустимая роль` });

    // Prevent self-demotion
    const token    = req.headers['x-auth-token'];
    const self     = token ? sessionGetUser(token) : null;
    if (self && String(self.id) === String(req.params.id) && role && role !== 'admin') {
      return res.status(400).json({ error: 'Нельзя понизить собственную роль' });
    }

    if (password) {
      const hash = hashPassword(password);
      run('UPDATE users SET password=?, must_change_password=0 WHERE id=?', [hash, req.params.id]);
    }
    if (role) run('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
    saveDb();
    res.json({ ok: true });
  });

  router.delete('/users/:id', adminOnly, (req, res) => {
    const users = getUsers();
    const admins = users.filter(u => u.role === 'admin');
    const target = users.find(u => u.id == req.params.id);
    if (target?.role === 'admin' && admins.length <= 1) {
      return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
    }
    run('DELETE FROM users WHERE id=?', [req.params.id]);
    run('DELETE FROM sessions WHERE user_id=?', [req.params.id]);
    saveDb();
    res.json({ ok: true });
  });

  return router;
};
