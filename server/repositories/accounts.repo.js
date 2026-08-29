/**
 * server/repositories/accounts.repo.js
 *
 * Фаза 3 рефакторинга: методы учётных записей, вынесенные из database.js
 * без изменения поведения.
 * Фаза 7c: переведено с lowdb (config.json) на SQLite — пилотная таблица
 * миграции, см. server/db/sqlite.js.
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');

const stmts = {
  selectAll: sqlite.prepare('SELECT * FROM accounts ORDER BY created_at'),
  selectOne: sqlite.prepare('SELECT * FROM accounts WHERE id = ?'),
  insert:    sqlite.prepare('INSERT INTO accounts (id, name, login, password, note, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  update:    sqlite.prepare('UPDATE accounts SET name = ?, login = ?, password = ?, note = ?, category = ? WHERE id = ?'),
  del:       sqlite.prepare('DELETE FROM accounts WHERE id = ?'),
};

function getAccounts() {
  return stmts.selectAll.all();
}

function addAccount({ name, login='', password='', note='', category='' }) {
  if (!name) throw new Error('Name required');
  const id = uuidv7();
  const created_at = new Date().toISOString();
  stmts.insert.run(id, name, login, password, note, category, created_at);
  return { id, ok: true };
}

function updateAccount(id, { name, login, password, note, category }) {
  const acc = stmts.selectOne.get(id);
  if (!acc) throw new Error('Not found');
  stmts.update.run(
    name     ?? acc.name,
    login    ?? acc.login,
    password ?? acc.password,
    note     ?? acc.note,
    category ?? acc.category ?? '',
    id
  );
  return { ok: true };
}

function deleteAccount(id) {
  const acc = stmts.selectOne.get(id);
  if (!acc) throw new Error('Not found');
  stmts.del.run(id);
  return { ok: true };
}

module.exports = { getAccounts, addAccount, updateAccount, deleteAccount };
