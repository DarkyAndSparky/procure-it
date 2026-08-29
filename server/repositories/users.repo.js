/**
 * server/repositories/users.repo.js
 *
 * Фаза 3 рефакторинга: методы пользователей системы, вынесенные из
 * database.js без изменения поведения.
 * Фаза 7c-5: переведено с lowdb (config.json) на SQLite. Уникальность
 * login по-прежнему проверяется в JS (регистронезависимо, как в
 * оригинале), не через DB constraint — см. комментарий в sqlite.js.
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');
const { hashPin, verifyPin } = require('../pin');

const stmts = {
  selectActive: sqlite.prepare('SELECT * FROM users WHERE active = 1'),
  selectAll:    sqlite.prepare('SELECT * FROM users'),
  selectOne:    sqlite.prepare('SELECT * FROM users WHERE id = ?'),
  insert:       sqlite.prepare('INSERT INTO users (id, name, login, role, pin, email, active, can_view_accounts, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'),
  update:       sqlite.prepare('UPDATE users SET name = ?, login = ?, role = ?, pin = ?, email = ?, active = ?, can_view_accounts = ? WHERE id = ?'),
  del:          sqlite.prepare('DELETE FROM users WHERE id = ?'),
};

function toBool(row) {
  return row && { ...row, active: !!row.active, can_view_accounts: !!row.can_view_accounts };
}

function getUsers(activeOnly = true) {
  const rows = activeOnly ? stmts.selectActive.all() : stmts.selectAll.all();
  return rows.map(toBool);
}

function getUser(id) {
  if (!id) return null;
  return toBool(stmts.selectOne.get(id)) || null;
}

function authUser(userId, pin) {
  const user = getUser(userId);
  if (!user || !user.active) return null;
  if (verifyPin(pin, user.pin)) return user;
  return null;
}

function authByLogin(login, password) {
  const users = getUsers(false);
  const user = users.find(u => u.active && u.login && u.login.toLowerCase() === String(login || '').trim().toLowerCase());
  if (!user) return null;
  if (!verifyPin(password, user.pin)) return null;
  return user;
}

function createUser({ name, login = '', role = 'operator', pin = '', email = '', can_view_accounts = false }) {
  if (!name) throw new Error('name обязателен');
  const users = getUsers(false);
  if (login && users.find(u => u.login && u.login.toLowerCase() === login.trim().toLowerCase()))
    throw new Error('Логин уже занят');
  const id = uuidv7();
  const created_at = new Date().toISOString();
  const loginTrimmed = String(login || '').trim();
  const emailNorm = String(email || '').trim().toLowerCase();
  const pinHash = hashPin(pin);
  stmts.insert.run(id, name, loginTrimmed, role, pinHash, emailNorm, can_view_accounts ? 1 : 0, created_at);
  return getUser(id);
}

function updateUser(id, fields) {
  const user = stmts.selectOne.get(id);
  if (!user) throw new Error('Пользователь не найден');
  if (fields.pin !== undefined) fields = { ...fields, pin: hashPin(fields.pin) };

  let allowed;
  if (user.id === 'sys-user-admin') {
    if (fields.role && fields.role !== 'admin')
      throw new Error('Нельзя изменить роль системного администратора');
    if (fields.active === false)
      throw new Error('Нельзя деактивировать системного администратора');
    allowed = ['name', 'login', 'pin', 'email'];
  } else {
    allowed = ['name', 'login', 'role', 'pin', 'email', 'active', 'can_view_accounts'];
  }

  const next = { ...user };
  allowed.forEach(k => { if (fields[k] !== undefined) next[k] = fields[k]; });

  stmts.update.run(
    next.name, next.login, next.role, next.pin, next.email,
    (next.active !== false && next.active !== 0) ? 1 : 0,
    next.can_view_accounts ? 1 : 0,
    id
  );
  return getUser(id);
}

function deleteUser(id) {
  if (id === 'sys-user-admin') throw new Error('Нельзя удалить системного администратора');
  stmts.del.run(id);
  return { ok: true };
}

module.exports = {
  getUsers, getUser, authUser, authByLogin, createUser, updateUser, deleteUser,
};
