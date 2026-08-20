const { getDb, saveDb } = require('../db/connection');
const { hashPassword, generateSalt, hashPasswordLegacy, hashPasswordSharedSaltPbkdf2, timingSafeStringEqual } = require('./crypto');
const { LEGACY_PASSWORD } = require('../config');

function getUsers() {
  const db = getDb();
  try {
    const rows = db.exec('SELECT id, username, role, must_change_password FROM users ORDER BY id');
    return rows[0] ? rows[0].values.map(([id, username, role, mcp]) => ({ id, username, role, mustChangePassword: !!mcp })) : [];
  } catch(e) { return []; }
}

// Переводит найденную запись на текущий формат (PBKDF2 + соль-на-
// пользователя) после успешной проверки пароля по одному из старых
// форматов — тот же приём, что уже применялся при переходе с голого
// SHA-256 на общую соль PBKDF2, теперь ещё на один шаг: с общей соли на
// соль-на-пользователя.
function upgradeToPerUserSalt(id, password) {
  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  getDb().run('UPDATE users SET password=?, salt=? WHERE id=?', [hash, salt, id]);
  saveDb();
  console.log(`[users] Upgraded password hash for user id=${id} to per-user-salt PBKDF2`);
}

function findUserByCredentials(username, password) {
  const db = getDb();
  try {
    const rows = db.exec('SELECT id, username, role, must_change_password, password, salt FROM users WHERE username=?', [username]);
    if (rows[0]?.values?.length) {
      const [id, uname, role, mcp, storedHash, salt] = rows[0].values[0];

      if (salt) {
        // Текущий формат — соль-на-пользователя.
        if (timingSafeStringEqual(hashPassword(password, salt), storedHash)) {
          return { id, username: uname, role, mustChangePassword: !!mcp };
        }
        return null;
      }

      // salt='' — запись в одном из двух старых форматов, доиграть при
      // успешном входе (см. upgradeToPerUserSalt).
      if (timingSafeStringEqual(hashPasswordSharedSaltPbkdf2(password), storedHash)) {
        upgradeToPerUserSalt(id, password);
        return { id, username: uname, role, mustChangePassword: !!mcp };
      }
      if (timingSafeStringEqual(hashPasswordLegacy(password), storedHash)) {
        upgradeToPerUserSalt(id, password);
        return { id, username: uname, role, mustChangePassword: !!mcp };
      }
      return null;
    }
    // Legacy fallback: if no users in DB, accept LEGACY_PASSWORD as admin
    const userCount = db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] || 0;
    // Уязвимость (найдена при аудите): было `password === LEGACY_PASSWORD`
    // — в отличие от сравнения ХЭШЕЙ выше, тут сравнивается СЫРОЙ секрет
    // (LEGACY_PASSWORD задаётся человеком в .env, может быть коротким) с
    // пользовательским вводом напрямую. Это ровно тот случай, где обычное
    // `===` — реальный, а не теоретический риск тайминг-атаки.
    if (userCount === 0 && LEGACY_PASSWORD && timingSafeStringEqual(password, LEGACY_PASSWORD)) {
      return { id: 0, username: 'admin', role: 'admin', mustChangePassword: false };
    }
    return null;
  } catch(e) { return null; }
}

module.exports = { getUsers, findUserByCredentials };
