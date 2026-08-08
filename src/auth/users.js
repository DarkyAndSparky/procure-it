const { getDb, saveDb } = require('../db/connection');
const { hashPassword, hashPasswordLegacy } = require('./crypto');
const { LEGACY_PASSWORD } = require('../config');

function getUsers() {
  const db = getDb();
  try {
    const rows = db.exec('SELECT id, username, role, must_change_password FROM users ORDER BY id');
    return rows[0] ? rows[0].values.map(([id, username, role, mcp]) => ({ id, username, role, mustChangePassword: !!mcp })) : [];
  } catch(e) { return []; }
}

function findUserByCredentials(username, password) {
  const db = getDb();
  try {
    const hash       = hashPassword(password);
    const legacyHash = hashPasswordLegacy(password);
    // Try PBKDF2 first
    let rows = db.exec('SELECT id, username, role, must_change_password FROM users WHERE username=? AND password=?', [username, hash]);
    if (!rows[0]?.values?.length) {
      // Try legacy SHA-256 — migrate on the fly
      rows = db.exec('SELECT id, username, role, must_change_password FROM users WHERE username=? AND password=?', [username, legacyHash]);
      if (rows[0]?.values?.length) {
        const [id] = rows[0].values[0];
        // Upgrade to PBKDF2
        db.run('UPDATE users SET password=? WHERE id=?', [hash, id]);
        saveDb();
        console.log(`[users] Upgraded password hash for user id=${id} to PBKDF2`);
      }
    }
    if (rows[0]?.values?.length) {
      const [id, uname, role, mcp] = rows[0].values[0];
      return { id, username: uname, role, mustChangePassword: !!mcp };
    }
    // Legacy fallback: if no users in DB, accept LEGACY_PASSWORD as admin
    const userCount = db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] || 0;
    if (userCount === 0 && LEGACY_PASSWORD && password === LEGACY_PASSWORD) {
      return { id: 0, username: 'admin', role: 'admin', mustChangePassword: false };
    }
    return null;
  } catch(e) { return null; }
}

module.exports = { getUsers, findUserByCredentials };
