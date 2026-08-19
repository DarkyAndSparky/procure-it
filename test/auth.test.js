// Регрессионные тесты на аутентификацию — конкретно на переход с общей
// PBKDF2-соли на соль-на-пользователя (см. auth/crypto.js) и на то, что
// существующие записи (в т.ч. с самым старым голым SHA-256) доигрываются
// до нового формата при первом успешном входе, а не требуют принудительного
// сброса пароля всем сразу. Это была security-находка аудита, и по своей
// природе — ровно тот код, который легко тихо сломать при следующей правке
// auth-логики, не заметив локально: неправильный salt/hash в одном месте
// не роняет приложение, просто конкретный пользователь перестаёт входить.
//
// Изоляция от реальной БД: users.js ходит в БД через db/connection.js
// (getDb()/saveDb() — синглтон, завязанный на настоящий data/zakupki.db).
// Гонять тесты против реального файла разработки нельзя — подменяем модуль
// в require.cache на fake с in-memory sql.js Database (тот же приём и та же
// причина, что в schema.test.js: runMigrations() применяется к чистому
// инстансу, а не к диску).
const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { runMigrations } = require('../src/db/schema');
const {
  generateSalt, hashPassword, hashPasswordLegacy, hashPasswordSharedSaltPbkdf2,
} = require('../src/auth/crypto');

async function setup() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db); // сеет default admin (если !LEGACY_PASSWORD) — не мешает, отдельные логины в тестах

  const connectionPath = require.resolve('../src/db/connection');
  require.cache[connectionPath] = {
    id: connectionPath, filename: connectionPath, loaded: true,
    exports: { getDb: () => db, saveDb: () => {} /* no-op — тесты не пишут на диск */ },
  };
  delete require.cache[require.resolve('../src/auth/users')];
  const users = require('../src/auth/users');
  return { db, users };
}

test('generateSalt() возвращает разные значения — не общая константа', () => {
  const a = generateSalt();
  const b = generateSalt();
  assert.notEqual(a, b, 'две генерации соли не должны совпадать');
  assert.equal(a.length, 32, '16 байт в hex — 32 символа');
});

test('hashPassword() с одним паролем, но разными солями даёт разные хэши', () => {
  const s1 = generateSalt();
  const s2 = generateSalt();
  assert.notEqual(hashPassword('SamePassword1', s1), hashPassword('SamePassword1', s2),
    'общий пароль у двух пользователей не должен давать одинаковый хэш при разных солях');
});

test('текущий формат (salt заполнен): верный пароль логинит, неверный — нет', async () => {
  const { db, users } = await setup();
  const salt = generateSalt();
  db.run(`INSERT INTO users (username,password,salt,role,must_change_password) VALUES (?,?,?,?,?)`,
    ['alice', hashPassword('AlicePass1', salt), salt, 'operator', 0]);

  const ok = users.findUserByCredentials('alice', 'AlicePass1');
  assert.ok(ok, 'верный пароль должен логинить');
  assert.equal(ok.username, 'alice');
  assert.equal(ok.role, 'operator');

  const bad = users.findUserByCredentials('alice', 'WrongPass');
  assert.equal(bad, null, 'неверный пароль не должен логинить');
});

test('легаси-запись (общая PBKDF2-соль, salt=\'\') мигрирует на соль-на-пользователя при успешном входе', async () => {
  const { db, users } = await setup();
  const legacyHash = hashPasswordSharedSaltPbkdf2('OldPass1');
  db.run(`INSERT INTO users (username,password,salt,role,must_change_password) VALUES (?,?,?,?,?)`,
    ['legacyuser', legacyHash, '', 'operator', 0]);

  const before = db.exec(`SELECT salt FROM users WHERE username='legacyuser'`)[0].values[0][0];
  assert.equal(before, '', 'до входа соль должна быть пустой (старый формат)');

  const ok = users.findUserByCredentials('legacyuser', 'OldPass1');
  assert.ok(ok, 'вход по старому паролю должен сработать');

  const after = db.exec(`SELECT salt, password FROM users WHERE username='legacyuser'`)[0].values[0];
  const [newSalt, newHash] = after;
  assert.notEqual(newSalt, '', 'после входа соль должна быть проставлена');
  assert.equal(newHash, hashPassword('OldPass1', newSalt), 'новый хэш должен соответствовать новой соли');

  // Повторный вход тем же паролем — уже по новому формату, без повторной миграции
  const ok2 = users.findUserByCredentials('legacyuser', 'OldPass1');
  assert.ok(ok2, 'повторный вход после миграции должен работать');
});

test('самая старая запись (голый SHA-256) тоже мигрирует при успешном входе', async () => {
  const { db, users } = await setup();
  const oldestHash = hashPasswordLegacy('AncientPass1');
  db.run(`INSERT INTO users (username,password,salt,role,must_change_password) VALUES (?,?,?,?,?)`,
    ['ancientuser', oldestHash, '', 'operator', 0]);

  const ok = users.findUserByCredentials('ancientuser', 'AncientPass1');
  assert.ok(ok, 'вход по самому старому формату (SHA-256) должен сработать');

  const [newSalt, newHash] = db.exec(`SELECT salt, password FROM users WHERE username='ancientuser'`)[0].values[0];
  assert.notEqual(newSalt, '', 'после входа соль должна быть проставлена');
  assert.equal(newHash, hashPassword('AncientPass1', newSalt));
});

test('неверный пароль на легаси-записи НЕ мигрирует и НЕ логинит', async () => {
  const { db, users } = await setup();
  const legacyHash = hashPasswordSharedSaltPbkdf2('OldPass1');
  db.run(`INSERT INTO users (username,password,salt,role,must_change_password) VALUES (?,?,?,?,?)`,
    ['bob', legacyHash, '', 'operator', 0]);

  const bad = users.findUserByCredentials('bob', 'WrongGuess');
  assert.equal(bad, null, 'неверный пароль на легаси-записи должен быть отклонён');

  const stillSalt = db.exec(`SELECT salt FROM users WHERE username='bob'`)[0].values[0][0];
  assert.equal(stillSalt, '', 'провалившийся вход не должен трогать соль/хэш записи');
});

test('несуществующий пользователь — null, без LEGACY_PASSWORD-фолбэка', async () => {
  const { users } = await setup();
  const res = users.findUserByCredentials('nobody', 'whatever');
  assert.equal(res, null);
});
