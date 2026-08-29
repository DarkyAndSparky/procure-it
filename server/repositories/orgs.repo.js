/**
 * server/repositories/orgs.repo.js
 *
 * Фаза 1 рефакторинга: методы организаций и правил инв. номеров,
 * вынесенные из database.js без изменения поведения.
 * Фаза 7c-7: organizations + inv_rules переведены на SQLite. inv_rules —
 * настоящая дочерняя таблица (org_inv_rules, FK ON DELETE CASCADE).
 * Фаза 7c-8b: assets/history тоже в SQLite — весь файл теперь на SQL,
 * lowdb здесь больше не используется. Прямые запросы к assets/history
 * (не через assets.repo.js) — top-level require оттуда создал бы цикл,
 * так как database.js требует orgs.repo.js при построении db.config.
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');

const stmts = {
  selectAllIncl: sqlite.prepare('SELECT * FROM organizations ORDER BY created_at'),
  selectActive:  sqlite.prepare("SELECT * FROM organizations WHERE system = 0 ORDER BY created_at"),
  selectOne:     sqlite.prepare('SELECT * FROM organizations WHERE id = ?'),
  insertOrg:     sqlite.prepare('INSERT INTO organizations (id, name, short_code, status, system, created_at, renamed_from, renamed_at, liquidated_at) VALUES (?, ?, ?, ?, 0, ?, NULL, NULL, NULL)'),
  updateOrgCols: sqlite.prepare('UPDATE organizations SET name = COALESCE(?, name), short_code = COALESCE(?, short_code), status = COALESCE(?, status) WHERE id = ?'),
  rename:        sqlite.prepare('UPDATE organizations SET name = ?, renamed_from = ?, renamed_at = ? WHERE id = ?'),
  liquidate:     sqlite.prepare("UPDATE organizations SET status = 'liquidated', liquidated_at = ? WHERE id = ?"),

  rulesForOrg:   sqlite.prepare('SELECT * FROM org_inv_rules WHERE org_id = ? ORDER BY rule_order'),
  maxRuleOrder:  sqlite.prepare('SELECT COALESCE(MAX(rule_order), -1) AS m FROM org_inv_rules WHERE org_id = ?'),
  insertRule:    sqlite.prepare('INSERT INTO org_inv_rules (org_id, type_code, type_name, counter, format, active, rule_order) VALUES (?, ?, ?, 0, ?, 1, ?)'),
  toggleRule:    sqlite.prepare('UPDATE org_inv_rules SET active = ? WHERE org_id = ? AND type_code = ?'),
  renameRule:    sqlite.prepare('UPDATE org_inv_rules SET type_name = ? WHERE org_id = ? AND type_code = ?'),
  setCounter:    sqlite.prepare('UPDATE org_inv_rules SET counter = ? WHERE org_id = ? AND type_code = ?'),
  deleteRule:    sqlite.prepare('DELETE FROM org_inv_rules WHERE org_id = ? AND type_code = ?'),

  // Фаза 7c-8b: assets/history тоже в SQLite. Здесь нужны только плоские
  // колонки (без meta) — поэтому напрямую через sqlite, не через
  // assets.repo.js (top-level require оттуда создал бы цикл, см. шапку
  // файла — database.js требует orgs.repo.js при построении db.config).
  activeAssetsByOrg:   sqlite.prepare("SELECT * FROM assets WHERE status != 'списан' AND org_id = ?"),
  allAssetInvs:        sqlite.prepare("SELECT inv FROM assets WHERE inv IS NOT NULL AND inv != ''"),
  updateAssetOrgOnly:      sqlite.prepare('UPDATE assets SET org_id = ?, updated_at = ? WHERE id = ?'),
  updateAssetOrgAndInv:    sqlite.prepare('UPDATE assets SET org_id = ?, updated_at = ?, inv = ?, inv_prev = ? WHERE id = ?'),
  updateAssetInv:      sqlite.prepare('UPDATE assets SET inv = ?, updated_at = ? WHERE id = ?'),
  historyInsert:       sqlite.prepare('INSERT INTO history (id, asset_id, action_type, date, from_who, to_who, filial, location, equipment, model, type, serial, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
};

function rulesToBool(rows) {
  return rows.map(r => ({ ...r, active: !!r.active }));
}

// Прикрепляет inv_rules (массив, как было в lowdb) к строке организации.
function attachRules(org) {
  if (!org) return null;
  return { ...org, system: !!org.system, inv_rules: rulesToBool(stmts.rulesForOrg.all(org.id)) };
}

function getOrgs(includeSystem = false) {
  const rows = includeSystem ? stmts.selectAllIncl.all() : stmts.selectActive.all();
  return rows.map(attachRules);
}

function getOrg(id) {
  if (!id) return null;
  return attachRules(stmts.selectOne.get(id));
}

function createOrg({ name, short_code, inv_rules = [] }) {
  if (!name || !short_code) throw new Error('name и short_code обязательны');
  const code = short_code.toUpperCase();
  const existing = stmts.selectAllIncl.all();
  const dup = existing.find(o => o.short_code === code || o.name === name);
  if (dup) throw new Error(`Дублирует: ${dup.name} (${dup.short_code})`);

  const id = uuidv7();
  const created_at = new Date().toISOString();
  sqlite.exec('BEGIN');
  try {
    stmts.insertOrg.run(id, name, code, 'active', created_at);
    inv_rules.forEach((r, idx) => {
      stmts.insertRule.run(id, (r.type_code || '').toUpperCase(), r.type_name || '', r.format || '{org}-{type}-{N:05}', idx);
    });
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return getOrg(id);
}

function updateOrg(id, fields) {
  const org = stmts.selectOne.get(id);
  if (!org)       throw new Error('Организация не найдена');
  if (org.system) throw new Error('Нельзя изменить системную запись');
  stmts.updateOrgCols.run(fields.name ?? null, fields.short_code ?? null, fields.status ?? null, id);
  return getOrg(id);
}

function renameOrg(id, newName, changedBy = 'system') {
  const org = stmts.selectOne.get(id);
  if (!org)       throw new Error('Организация не найдена');
  if (org.system) throw new Error('Нельзя переименовать системную запись');
  const oldName = org.name;
  const now = new Date().toISOString();
  stmts.rename.run(newName, oldName, now, id);
  stmts.historyInsert.run(uuidv7(), null, 'org_renamed', now,
    oldName, newName, '', '',
    `Организация: ${oldName}`, '', '', '',
    `Переименование: «${oldName}» → «${newName}»`, changedBy);
  return getOrg(id);
}

function liquidateOrg(id, targetOrgId, changedBy = 'system', renumberInv = false) {
  const org = getOrg(id);
  if (!org)               throw new Error('Организация не найдена');
  if (org.system)         throw new Error('Нельзя ликвидировать системную запись');
  if (id === targetOrgId) throw new Error('Целевая организация совпадает с ликвидируемой');
  const target = getOrg(targetOrgId);
  if (!target) throw new Error('Целевая организация не найдена');

  const now = new Date().toISOString();
  const affected = stmts.activeAssetsByOrg.all(id);

  let renumbered = 0;
  const oldCode = org.short_code;
  const newCode = target.short_code;

  // Стартовый счётчик для каждого типа у target — ДО переноса, чтобы новые
  // номера не пересекались с уже существующими у target (иначе — дубликаты
  // инв. номеров, см. историю бага в roadmap Фазы 7c).
  const targetCounters = {};
  if (renumberInv) {
    const allInvs = stmts.allAssetInvs.all().map(r => r.inv);
    (target.inv_rules || []).forEach(rule => {
      const tp = `${newCode}-${rule.type_code}-`;
      targetCounters[rule.type_code] = allInvs
        .filter(inv => inv.startsWith(tp))
        .map(inv => parseInt(inv.slice(tp.length), 10))
        .filter(n => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), rule.counter || 0);
    });
  }

  sqlite.exec('BEGIN');
  try {
    affected.forEach(a => {
      let newInv = null, invPrev = null;
      if (renumberInv && a.inv && a.inv.startsWith(oldCode + '-')) {
        const oldTypeCode = a.inv.split('-')[1];
        const matchRule = (target.inv_rules || []).find(r => r.type_code === oldTypeCode);
        if (matchRule) {
          targetCounters[oldTypeCode] = (targetCounters[oldTypeCode] || 0) + 1;
          invPrev = a.inv;
          newInv = `${newCode}-${oldTypeCode}-${String(targetCounters[oldTypeCode]).padStart(5, '0')}`;
          renumbered++;
        }
      }
      if (newInv !== null) {
        stmts.updateAssetOrgAndInv.run(targetOrgId, now, newInv, invPrev, a.id);
      } else {
        stmts.updateAssetOrgOnly.run(targetOrgId, now, a.id);
      }
      stmts.historyInsert.run(uuidv7(), a.id, 'org_transfer', now,
        org.name, target.name, a.filial||'', a.location||'',
        `${a.type} ${a.model}`, a.model, a.type, a.serial,
        `Ликвидация «${org.name}» → «${target.name}»` +
          (renumberInv && newInv ? ` | инв: ${invPrev} → ${newInv}` : ''),
        changedBy);
    });

    if (renumberInv) {
      const allAssets = stmts.allAssetInvs.all().map(r => r.inv);
      (target.inv_rules || []).forEach(rule => {
        const prefix = `${newCode}-${rule.type_code}-`;
        const maxNum = allAssets
          .filter(inv => inv.startsWith(prefix))
          .map(inv => parseInt(inv.slice(prefix.length), 10))
          .filter(n => !isNaN(n))
          .reduce((m, n) => Math.max(m, n), rule.counter || 0);
        stmts.setCounter.run(maxNum, targetOrgId, rule.type_code);
      });
    }

    stmts.liquidate.run(now, id);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return { transferred: affected.length, renumbered };
}

function nextInv(orgId, typeCode, { reserve = true } = {}) {
  const org = getOrg(orgId);
  if (!org) throw new Error('Организация не найдена');
  const rule = (org.inv_rules||[]).find(r =>
    r.type_code === typeCode.toUpperCase() && r.active !== false
  );
  if (!rule) throw new Error(`Тип ${typeCode} не настроен для ${org.name}`);
  const prefix = `${org.short_code}-${rule.type_code}-`;
  const maxExisting = stmts.allAssetInvs.all().map(r => r.inv)
    .filter(inv => inv.startsWith(prefix))
    .map(inv => parseInt(inv.replace(prefix,''), 10))
    .filter(n => !isNaN(n))
    .reduce((m, n) => Math.max(m, n), rule.counter || 0);
  const next = maxExisting + 1;
  const inv  = `${prefix}${String(next).padStart(5, '0')}`;
  if (reserve) {
    stmts.setCounter.run(next, orgId, rule.type_code);
  }
  return { inv, next, prefix };
}

function addInvRule(orgId, { type_code, type_name, format = '{org}-{type}-{N:05}' }) {
  const org = getOrg(orgId);
  if (!org)       throw new Error('Организация не найдена');
  if (org.system) throw new Error('Нельзя добавить правило системной записи');
  const code = type_code.toUpperCase();
  if ((org.inv_rules||[]).find(r => r.type_code === code))
    throw new Error(`Правило ${code} уже существует`);
  const nextOrder = stmts.maxRuleOrder.get(orgId).m + 1;
  stmts.insertRule.run(orgId, code, type_name, format, nextOrder);
  return { type_code: code, type_name, counter: 0, format, active: true };
}

function toggleInvRule(orgId, typeCode, active) {
  stmts.toggleRule.run(active ? 1 : 0, orgId, typeCode.toUpperCase());
  return { ok: true };
}

function renameInvRule(orgId, typeCode, { type_name }) {
  const org = getOrg(orgId);
  if (!org) throw new Error('Организация не найдена');
  const code = typeCode.toUpperCase();
  const rule = (org.inv_rules||[]).find(r => r.type_code === code);
  if (!rule) throw new Error(`Правило ${code} не найдено`);
  if (!type_name || !type_name.trim()) throw new Error('type_name обязателен');
  stmts.renameRule.run(type_name.trim(), orgId, code);
  return { ok: true };
}

function deleteInvRule(orgId, typeCode) {
  const org = getOrg(orgId);
  if (!org) throw new Error('Организация не найдена');
  const code = typeCode.toUpperCase();
  const rule = (org.inv_rules||[]).find(r => r.type_code === code);
  if (!rule) throw new Error(`Правило ${code} не найдено`);
  const prefix = `${org.short_code}-${code}-`;
  const affected = sqlite.prepare('SELECT id FROM assets WHERE inv LIKE ?').all(prefix + '%');
  if (affected.length > 0) {
    return { conflict: true, count: affected.length, prefix, typeCode: code };
  }
  stmts.deleteRule.run(orgId, code);
  return { ok: true };
}

function deleteInvRuleForce(orgId, typeCode, action, targetTypeCode) {
  const org = getOrg(orgId);
  if (!org) throw new Error('Организация не найдена');
  const code = typeCode.toUpperCase();
  const rule = (org.inv_rules||[]).find(r => r.type_code === code);
  if (!rule) throw new Error(`Правило ${code} не найдено`);
  const prefix = `${org.short_code}-${code}-`;
  const now = new Date().toISOString();

  sqlite.exec('BEGIN');
  try {
    if (action === 'reset') {
      const toReset = sqlite.prepare('SELECT id FROM assets WHERE inv LIKE ?').all(prefix + '%');
      toReset.forEach(a => stmts.updateAssetInv.run('', now, a.id));
    } else if (action === 'transfer') {
      if (!targetTypeCode) throw new Error('targetTypeCode обязателен для transfer');
      const targetCode = targetTypeCode.toUpperCase();
      const targetRule = (org.inv_rules||[]).find(r => r.type_code === targetCode && r.active !== false);
      if (!targetRule) throw new Error(`Целевое правило ${targetCode} не найдено или неактивно`);
      const targetPrefix = `${org.short_code}-${targetCode}-`;
      let counter = stmts.allAssetInvs.all().map(r => r.inv)
        .filter(inv => inv.startsWith(targetPrefix))
        .map(inv => parseInt(inv.slice(targetPrefix.length), 10))
        .filter(n => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), targetRule.counter || 0);
      const toTransfer = sqlite.prepare('SELECT id FROM assets WHERE inv LIKE ?').all(prefix + '%');
      toTransfer.forEach(a => {
        counter++;
        const newInv = `${targetPrefix}${String(counter).padStart(5, '0')}`;
        stmts.updateAssetInv.run(newInv, now, a.id);
      });
      stmts.setCounter.run(counter, orgId, targetCode);
    } else {
      throw new Error(`Неизвестный action: ${action}`);
    }
    stmts.deleteRule.run(orgId, code);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

module.exports = {
  getOrgs, getOrg, createOrg, updateOrg, renameOrg, liquidateOrg,
  nextInv, addInvRule, toggleInvRule, renameInvRule, deleteInvRule, deleteInvRuleForce,
};
