/**
 * server/repositories/employees.repo.js
 *
 * Фаза 3 рефакторинга: методы сотрудников, вынесенные из database.js
 * без изменения поведения.
 * Фаза 7c-6: переведено с lowdb (config.json) на SQLite.
 * Фаза 7c-8b: assets тоже в SQLite — deleteEmployee подсчитывает
 * затронутые активы через assets.repo.js (lazy require — top-level
 * создал бы цикл через database.js, который требует employees.repo.js
 * при построении db).
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');

const stmts = {
  selectActive: sqlite.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY created_at'),
  selectAll:    sqlite.prepare('SELECT * FROM employees ORDER BY created_at'),
  selectOne:    sqlite.prepare('SELECT * FROM employees WHERE id = ?'),
  insert:       sqlite.prepare('INSERT INTO employees (id, name, dept, filial, phone, email, note, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'),
  update:       sqlite.prepare('UPDATE employees SET name=?, dept=?, filial=?, phone=?, email=?, note=?, active=? WHERE id=?'),
  deactivate:   sqlite.prepare('UPDATE employees SET active = 0, deactivated_at = ? WHERE id = ?'),
};

function toBool(row) {
  return row && { ...row, active: !!row.active };
}

function getEmployees(activeOnly = true) {
  const rows = activeOnly ? stmts.selectActive.all() : stmts.selectAll.all();
  return rows.map(toBool);
}

function getEmployee(id) {
  if (!id) return null;
  return toBool(stmts.selectOne.get(id)) || null;
}

function createEmployee({ name, dept = '', filial = '', phone = '', email = '', note = '' }) {
  if (!name || !name.trim()) throw new Error('ФИО обязательно');
  const id = uuidv7();
  const created_at = new Date().toISOString();
  stmts.insert.run(
    id, name.trim(), dept.trim(), filial.trim(), phone.trim(),
    email.trim().toLowerCase(), note.trim(), created_at
  );
  return getEmployee(id);
}

function updateEmployee(id, fields) {
  const e = stmts.selectOne.get(id);
  if (!e) throw new Error('Сотрудник не найден');
  const next = { ...e };
  ['name','dept','filial','phone','email','note','active'].forEach(k => {
    if (fields[k] !== undefined) next[k] = fields[k];
  });
  stmts.update.run(
    next.name, next.dept, next.filial, next.phone, next.email, next.note,
    (next.active !== false && next.active !== 0) ? 1 : 0,
    id
  );
  return getEmployee(id);
}

function deleteEmployee(id) {
  // Вместо удаления — деактивируем сотрудника
  const emp = getEmployee(id);
  if (!emp) throw new Error('Сотрудник не найден');

  stmts.deactivate.run(new Date().toISOString(), id);

  // Возвращаем информацию об оборудовании, которое нужно переместить.
  // Фаза 7c-8b: assets переехали в SQLite — через assetsRepo.getAllAssets(),
  // не сырой SQL, чтобы сохранить форму объекта (вложенный meta{}, а не
  // плоские meta_ip/meta_mac/... колонки) для потребителей поля `assets`.
  const assetsRepo = require('./assets.repo');
  const linked = assetsRepo.getAllAssets()
    .filter(a => a.status !== 'списан' && a.responsible === emp.name);

  return {
    ok: true,
    deactivated: true,
    employee: getEmployee(id),
    linked_assets: linked.length,
    assets: linked
  };
}

function searchEmployees(q) {
  if (!q || q.trim().length < 2) return [];
  const key = q.trim().toLowerCase();
  return stmts.selectActive.all()
    .map(toBool)
    .filter(e =>
      e.name.toLowerCase().includes(key) ||
      e.dept.toLowerCase().includes(key) ||
      e.phone.includes(key)
    )
    .slice(0, 15);
}

module.exports = {
  getEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee, searchEmployees,
};
