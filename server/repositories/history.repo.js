/**
 * server/repositories/history.repo.js
 *
 * Фаза 4 рефакторинга: история изменений активов, вынесенная из index.js
 * без изменения поведения.
 * Фаза 7c-8b: history + assets переведены на SQLite, organizations уже
 * в SQL с Фазы 7c-7 — все три источника здесь теперь через SQL-API.
 */
'use strict';

const db = require('../database');
const assetsRepo = require('./assets.repo');
const { sqlite } = require('../db/sqlite');

const selectAllHistory = sqlite.prepare('SELECT * FROM history ORDER BY rowid DESC');

function listHistory(query) {
  const { limit=500, offset=0, asset_id, action_type, filial, org,
          changed_by, search, from_date, to_date } = query;
  let items = selectAllHistory.all();

  const orgMap = Object.fromEntries(
    db.config.getOrgs(true).map(o => [o.id, o.name])
  );
  const assetOrgMap = {};
  assetsRepo.getAllAssets().forEach(a => {
    if (a.id) {
      assetOrgMap[a.id] = (a.org_id && orgMap[a.org_id]) ? orgMap[a.org_id] : (a.org || '');
    }
  });

  items = items.map(h => ({
    ...h,
    org_name: h.org_snapshot || h.org || (h.asset_id ? assetOrgMap[h.asset_id] : '') || '',
  }));

  if (asset_id)    items = items.filter(h => h.asset_id === asset_id);
  if (action_type) items = items.filter(h => h.action_type === action_type);
  if (filial)      items = items.filter(h => h.filial === filial);
  if (org)         items = items.filter(h => h.org_name === org);
  if (changed_by)  items = items.filter(h => h.changed_by === changed_by);
  if (from_date)   items = items.filter(h => h.date >= from_date);
  if (to_date)     items = items.filter(h => h.date <= to_date + 'T23:59:59');
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(h =>
      (h.equipment||'').toLowerCase().includes(q) ||
      (h.from_who||'').toLowerCase().includes(q) ||
      (h.to_who||'').toLowerCase().includes(q) ||
      (h.reason||'').toLowerCase().includes(q) ||
      (h.serial||'').toLowerCase().includes(q) ||
      (h.org_name||'').toLowerCase().includes(q)
    );
  }
  const total = items.length;

  const filterOptions = {
    filials: [...new Set(items.map(h => h.filial).filter(Boolean))].sort(),
    orgs:    [...new Set(items.map(h => h.org_name).filter(Boolean))].sort(),
    authors: [...new Set(items.map(h => h.changed_by).filter(Boolean))].sort(),
  };

  const off = parseInt(offset) || 0;
  // SEC-8: раньше limit просто парсился без потолка — можно было запросить
  // ?limit=1000000 и получить всю историю разом одним ответом. Кап такой
  // же по духу, что и у /api/assets (там 200), но повыше — у истории
  // изначально дефолт был 500, оставляем его как верхнюю границу тоже.
  const lim = Math.min(parseInt(limit) || 500, 500);
  items = items.slice(off, off + lim);

  const all = selectAllHistory.all();
  const stats = {
    total: all.length,
    today: all.filter(h => h.date && h.date.slice(0,10) === new Date().toISOString().slice(0,10)).length,
    moves: all.filter(h => !h.action_type || h.action_type === 'move').length,
    adds:  all.filter(h => h.action_type === 'add').length,
    retires: all.filter(h => h.action_type === 'retire').length,
    imports: all.filter(h => h.action_type === 'import').length,
  };

  return { items, total, stats, filterOptions };
}

module.exports = { listHistory };
