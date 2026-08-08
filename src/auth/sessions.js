const { getDb, saveDb } = require('../db/connection');

function sessionCreate(token, userId) {
  const db = getDb();
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
  try {
    db.run('INSERT OR REPLACE INTO sessions (token, expires_at, user_id) VALUES (?,?,?)', [token, expiresAt, userId || 0]);
    saveDb();
  } catch(e) { console.error('[sessions] create error:', e.message); }
}

function sessionDelete(token) {
  const db = getDb();
  try { db.run('DELETE FROM sessions WHERE token = ?', [token]); saveDb(); } catch(e) {}
}

function sessionGetUser(token) {
  const db = getDb();
  try {
    const rows = db.exec('SELECT expires_at, user_id FROM sessions WHERE token = ?', [token]);
    if (!rows.length || !rows[0].values.length) return null;
    const [expiresAt, userId] = rows[0].values[0];
    if (Date.now() > expiresAt) { sessionDelete(token); return null; }
    if (!userId) {
      // Legacy session (pre-multi-user) — only grant admin if no users table exists yet
      const userCount = (() => { try { return db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] || 0; } catch(e) { return 0; } })();
      if (userCount === 0) return { id: 0, username: 'admin', role: 'admin', mustChangePassword: false };
      return null; // legacy session invalid once users table is populated
    }
    const urows = db.exec('SELECT id, username, role, must_change_password FROM users WHERE id=?', [userId]);
    if (!urows[0]?.values?.length) return null;
    const [id, username, role, mcp] = urows[0].values[0];
    return { id, username, role, mustChangePassword: !!mcp };
  } catch(e) { return null; }
}

module.exports = { sessionCreate, sessionDelete, sessionGetUser };
