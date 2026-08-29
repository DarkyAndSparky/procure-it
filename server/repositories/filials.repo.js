/**
 * server/repositories/filials.repo.js
 *
 * Фаза 1 рефакторинга: методы филиалов, вынесенные из database.js
 * без изменения поведения.
 * Фаза 7c-2: переведено с lowdb (config.json) на SQLite.
 * org_id — ссылка на organizations (в SQL с Фазы 7c-7, без FK-constraint
 * между filials и organizations — исторически не было ссылочной
 * целостности между этими коллекциями, не добавляем её сейчас заодно).
 * closeFilial — с Фазы 7c-8b подсчёт затронутых активов тоже через SQL
 * (assets переехали туда же).
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');

const stmts = {
  selectAllIncl: sqlite.prepare('SELECT * FROM filials ORDER BY created_at'),
  selectActive:  sqlite.prepare('SELECT * FROM filials WHERE system = 0 ORDER BY created_at'),
  selectOne:     sqlite.prepare('SELECT * FROM filials WHERE id = ?'),
  insert:        sqlite.prepare('INSERT INTO filials (id, name, address, org_id, status, system, created_at, closed_at) VALUES (?, ?, ?, ?, ?, 0, ?, NULL)'),
  updateName:    sqlite.prepare('UPDATE filials SET name = ? WHERE id = ?'),
  updateAddress: sqlite.prepare('UPDATE filials SET address = ? WHERE id = ?'),
  updateOrgId:   sqlite.prepare('UPDATE filials SET org_id = ? WHERE id = ?'),
  close:         sqlite.prepare('UPDATE filials SET status = ?, closed_at = ? WHERE id = ?'),
};

// node:sqlite возвращает system как 0/1 — приводим к boolean на границе
// repo-слоя, чтобы наружу форма объекта не отличалась от прежней (lowdb).
function toBool(row) {
  return row && { ...row, system: !!row.system };
}

function getFilials(includeSystem = false) {
  const rows = includeSystem ? stmts.selectAllIncl.all() : stmts.selectActive.all();
  return rows.map(toBool);
}

function getFilial(id) {
  return toBool(stmts.selectOne.get(id)) || null;
}

function createFilial({ name, address = '', org_id = null }) {
  if (!name) throw new Error('name обязателен');
  const id = uuidv7();
  const created_at = new Date().toISOString();
  stmts.insert.run(id, name, address, org_id, 'active', created_at);
  return getFilial(id);
}

function updateFilial(id, fields) {
  const f = stmts.selectOne.get(id);
  if (!f)       throw new Error('Филиал не найден');
  if (f.system) throw new Error('Нельзя изменить системную запись');
  if (fields.name !== undefined)    stmts.updateName.run(fields.name, id);
  if (fields.address !== undefined) stmts.updateAddress.run(fields.address, id);
  if (fields.org_id !== undefined)  stmts.updateOrgId.run(fields.org_id, id);
  return getFilial(id);
}

function closeFilial(id, changedBy = 'system') {
  const f = stmts.selectOne.get(id);
  if (!f)       throw new Error('Филиал не найден');
  if (f.system) throw new Error('Нельзя закрыть системную запись');
  // Фаза 7c-8b: assets переехали в SQLite — прямой запрос вместо db.get('assets') (lowdb)
  const affected = sqlite.prepare(
    "SELECT COUNT(*) AS c FROM assets WHERE status != 'списан' AND filial_id = ?"
  ).get(id).c;
  stmts.close.run('closed', new Date().toISOString(), id);
  return { closed:true, affected_assets: affected };
}

module.exports = { getFilials, getFilial, createFilial, updateFilial, closeFilial };
