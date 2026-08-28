const express = require('express');
const router = express.Router();

const { getDb, saveDb, run } = require('../db/connection');
const { getUsers, findUserByCredentials } = require('../auth/users');
const { sessionCreate, sessionDelete, sessionGetUser } = require('../auth/sessions');
const { generateToken, generateSalt, hashPassword, timingSafeStringEqual } = require('../auth/crypto');
const { adminOnly } = require('../auth/middleware');
const { LEGACY_PASSWORD } = require('../config');
const { isSmtpConfigured, sendPasswordResetEmail, getSmtpConfig } = require('../services/emailService');

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
      // Соль-на-пользователя (см. auth/crypto.js) — читаем текущую соль
      // записи, а не хэшируем константой; findUserByCredentials() уже
      // догнал строку до этого формата при входе (или это новый пользователь,
      // у которого он был с самого начала).
      const row = getDb().exec('SELECT password, salt FROM users WHERE id=?', [user.id])[0]?.values?.[0];
      if (!row || !timingSafeStringEqual(hashPassword(currentPassword, row[1]), row[0])) {
        return res.status(401).json({ error: 'Текущий пароль неверен' });
      }
    }
    const newSalt = generateSalt();
    run('UPDATE users SET password=?, salt=?, must_change_password=0 WHERE id=?', [hashPassword(newPassword, newSalt), newSalt, user.id]);
    saveDb();
    res.json({ ok: true });
  });

  // ── Сброс пароля ──────────────────────────────────────────────────────────────
  // Возвращает флаг — настроен ли SMTP для отправки ссылки сброса.
  // Фронтенд использует это чтобы показать либо форму email, либо инструкцию
  // «обратитесь к администратору».
  router.get('/auth/reset-password-info', (req, res) => {
    res.json({ smtpConfigured: isSmtpConfigured() });
  });

  // Инициирует сброс пароля: ищет пользователя по email (поле пока не
  // обязательное — если email не привязан, возвращаем ok:true без деталей,
  // чтобы не раскрывать, есть ли такой email). Когда SMTP настроен —
  // отправляет письмо со ссылкой. Сейчас просто генерирует токен и пишет
  // в лог — до реализации email-рассылки (SMTP в настройках).
  router.post('/auth/reset-password-request', strictLimiter, (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Укажите email' });
    const db = getDb();
    // Ищем пользователя по email (колонка может отсутствовать в старых БД)
    let user = null;
    try {
      const rows = db.exec('SELECT id, username FROM users WHERE email=?', [email.trim().toLowerCase()]);
      if (rows[0]?.values?.length) {
        const [id, username] = rows[0].values[0];
        user = { id, username };
      }
    } catch(e) { /* колонка email ещё не мигрирована — игнорируем */ }

    if (user) {
      const token = require('crypto').randomBytes(32).toString('hex');
      const expires = Date.now() + 60 * 60 * 1000; // 1 час
      try {
        db.run('DELETE FROM password_reset_tokens WHERE user_id=?', [user.id]);
        db.run('INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?,?,?)',
          [token, user.id, expires]);
        const { saveDb } = require('../db/connection');
        saveDb();

        // Формируем URL сброса. Берём origin из заголовка запроса — это
        // корректный хост/порт даже за reverse-proxy (если тот прокидывает
        // X-Forwarded-Host). Фолбэк — конструируем из req.protocol + host.
        const origin = req.headers['x-forwarded-proto']
          ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host'] || req.headers.host}`
          : `${req.protocol}://${req.headers.host}`;
        const resetUrl = `${origin}/reset-password?token=${token}`;

        // Отправляем письмо асинхронно — не держим HTTP-ответ.
        // Ошибка отправки логируется, но не возвращается клиенту
        // (чтобы не раскрывать наличие адреса через тайминг/ошибку).
        const smtpCfg = getSmtpConfig();
        sendPasswordResetEmail({
          to: email.trim(),
          username: user.username,
          resetUrl,
          appName: smtpCfg.appName,
        }).catch(e => console.error(`[auth] Ошибка отправки письма сброса для ${user.username}:`, e.message));

        console.log(`[auth] Сброс пароля для ${user.username} (${email}): ${resetUrl}`);
      } catch(e) {
        console.error('[auth] Ошибка создания токена сброса:', e.message);
      }
    }
    // Всегда отвечаем ok — не раскрываем, зарегистрирован ли email
    res.json({ ok: true });
  });

  // Применяет новый пароль по токену сброса
  router.post('/auth/reset-password', strictLimiter, (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Укажите токен и новый пароль' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Минимум 6 символов' });
    const db = getDb();
    try {
      const rows = db.exec('SELECT user_id, expires_at FROM password_reset_tokens WHERE token=?', [token]);
      if (!rows[0]?.values?.length) return res.status(400).json({ error: 'Недействительный или просроченный токен' });
      const [userId, expiresAt] = rows[0].values[0];
      if (Date.now() > expiresAt) {
        db.run('DELETE FROM password_reset_tokens WHERE token=?', [token]);
        return res.status(400).json({ error: 'Токен истёк, запросите сброс заново' });
      }
      const { generateSalt, hashPassword } = require('../auth/crypto');
      const salt = generateSalt();
      const hash = hashPassword(newPassword, salt);
      db.run('UPDATE users SET password=?, salt=?, must_change_password=0 WHERE id=?', [hash, salt, userId]);
      db.run('DELETE FROM password_reset_tokens WHERE token=?', [token]);
      db.run('DELETE FROM sessions WHERE user_id=?', [userId]);
      const { saveDb } = require('../db/connection');
      saveDb();
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Users API (admin only) ──────────────────────────────────────────────────
  router.get('/users', adminOnly, (req, res) => {
    res.json(getUsers());
  });

  router.post('/users', adminOnly, (req, res) => {
    const { username, password, role, email } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
    const ROLES = ['viewer', 'operator', 'admin'];
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Роль должна быть: ${ROLES.join(', ')}` });
    try {
      const salt = generateSalt();
      const hash = hashPassword(password, salt);
      const userEmail = (email || '').trim().toLowerCase();
      run('INSERT INTO users (username, password, salt, role, email) VALUES (?,?,?,?,?)', [username, hash, salt, role, userEmail]);
      saveDb();
      res.json({ ok: true });
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Пользователь уже существует' });
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/users/:id', adminOnly, (req, res) => {
    const { password, role, email } = req.body;
    const ROLES = ['viewer', 'operator', 'admin'];
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: `Недопустимая роль` });

    // Prevent self-demotion
    const token    = req.headers['x-auth-token'];
    const self     = token ? sessionGetUser(token) : null;
    if (self && String(self.id) === String(req.params.id) && role && role !== 'admin') {
      return res.status(400).json({ error: 'Нельзя понизить собственную роль' });
    }

    if (password) {
      const salt = generateSalt();
      const hash = hashPassword(password, salt);
      run('UPDATE users SET password=?, salt=?, must_change_password=0 WHERE id=?', [hash, salt, req.params.id]);
    }
    if (role) run('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
    if (email !== undefined) run('UPDATE users SET email=? WHERE id=?', [(email || '').trim().toLowerCase(), req.params.id]);
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
