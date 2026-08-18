function generateToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

// Уязвимость (найдена при аудите): раньше соль для PBKDF2 была одной
// константой на всё приложение ('procure-it-pbkdf2-salt-v1'), общей для
// ВСЕХ пользователей. Это не давало атакующему, укравшему БД (например,
// через утёкший бэкап), ничего экономить внутри одного хэша — 100k
// итераций всё ещё дороги — но позволяло вести одну атаку подбора сразу
// по всем аккаунтам параллельно (общий precomputed/rainbow-набор), вместо
// того чтобы атаковать каждый аккаунт отдельно. Теперь соль генерируется
// на каждого пользователя отдельно и хранится рядом с хэшем (users.salt).
function generateSalt() {
  return require('crypto').randomBytes(16).toString('hex');
}

// salt обязателен — соль-на-пользователя, а не общая константа (см. выше).
function hashPassword(pw, salt) {
  const { pbkdf2Sync } = require('crypto');
  return pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('hex');
}

// Миграция шаг 1 (самый старый формат): голый SHA-256 с общей солью —
// как хранились пароли до перехода на PBKDF2.
function hashPasswordLegacy(pw) {
  return require('crypto').createHash('sha256').update(pw + 'procure-it-salt').digest('hex');
}

// Миграция шаг 2: PBKDF2, но ещё с общей константной солью на всех —
// формат, который использовался до перехода на соль-на-пользователя.
// Нужен только для доиграть существующие записи на следующий вход в
// систему (см. users.js findUserByCredentials) — новые пароли им уже не
// хэшируются.
function hashPasswordSharedSaltPbkdf2(pw) {
  const { pbkdf2Sync } = require('crypto');
  return pbkdf2Sync(pw, 'procure-it-pbkdf2-salt-v1', 100000, 32, 'sha256').toString('hex');
}

module.exports = { generateToken, generateSalt, hashPassword, hashPasswordLegacy, hashPasswordSharedSaltPbkdf2 };
