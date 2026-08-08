function generateToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

function hashPassword(pw) {
  // PBKDF2-SHA256, 100k iterations — much stronger than plain SHA-256
  const { pbkdf2Sync } = require('crypto');
  return pbkdf2Sync(pw, 'procure-it-pbkdf2-salt-v1', 100000, 32, 'sha256').toString('hex');
}

// Migration: rehash old SHA-256 passwords to PBKDF2 on next login
function hashPasswordLegacy(pw) {
  return require('crypto').createHash('sha256').update(pw + 'procure-it-salt').digest('hex');
}

module.exports = { generateToken, hashPassword, hashPasswordLegacy };
