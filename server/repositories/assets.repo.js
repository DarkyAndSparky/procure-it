/**
 * server/repositories/assets.repo.js
 *
 * Фаза 4 рефакторинга (самая рискованная и самая большая часть монолита):
 * вся работа с активами, вынесенная из index.js без изменения поведения.
 *
 * Фаза 7c-8b: assets + history переведены на SQLite — самая крупная
 * подфаза миграции (assets/history использовались в 11 файлах, 58 точек
 * db.get()). Мета-поля (ip/mac/...) хранятся отдельными колонками
 * (meta_*), собираются в объект meta{} на границе repo-слоя — снаружи
 * (роуты, фронтенд) форма объекта не меняется.
 *
 * changedBy передаётся как ГОТОВАЯ СТРОКА (не req) — маршруты вычисляют
 * её через middleware/auth.js::changedBy(req) до вызова repo.
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const db = require('../database');
const { sqlite, META_KEYS } = require('../db/sqlite');

const ASSET_COLS = ['id','tab','category','filial','address','location','responsible',
  'type','model','serial','status','org','note','inv','inv_prev',
  'org_id','filial_id','location_id','responsible_id','created_at','updated_at',
  ...META_KEYS.map(k => 'meta_' + k)];

const stmts = {
  selectAll:      sqlite.prepare('SELECT * FROM assets'),
  selectActive:   sqlite.prepare("SELECT * FROM assets WHERE status != 'списан'"),
  selectOne:      sqlite.prepare('SELECT * FROM assets WHERE id = ?'),
  insert:         sqlite.prepare(`INSERT INTO assets (${ASSET_COLS.join(', ')}) VALUES (${ASSET_COLS.map(()=>'?').join(', ')})`),
  historyInsert:  sqlite.prepare(`INSERT INTO history (id, asset_id, action_type, date, from_who, to_who, filial, location, equipment, model, type, serial, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
};

// Строка SQL -> объект актива с вложенным meta{} (только заданные ключи,
// как было в оригинале — не пустой объект с кучей null).
function rowToAsset(row) {
  if (!row) return null;
  const { ...rest } = row;
  const meta = {};
  for (const k of META_KEYS) {
    const col = 'meta_' + k;
    if (rest[col] !== null && rest[col] !== undefined) meta[k] = rest[col];
    delete rest[col];
  }
  return { ...rest, meta };
}

// Собирает UPDATE SET-выражение из произвольного набора полей (включая
// вложенные meta.*), пропуская неизвестные ключи.
function buildUpdate(fields) {
  const cols = [], vals = [];
  const PLAIN = ['tab','category','filial','address','location','responsible',
    'type','model','serial','status','org','note','inv','inv_prev',
    'org_id','filial_id','location_id','responsible_id'];
  for (const k of PLAIN) {
    if (fields[k] !== undefined) { cols.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (fields.meta && typeof fields.meta === 'object') {
    for (const k of META_KEYS) {
      if (fields.meta[k] !== undefined) { cols.push(`meta_${k} = ?`); vals.push(fields.meta[k] || null); }
    }
  }
  return { cols, vals };
}

function _resolveOrgName(a, orgMap) {
  const SYS_ORG = new Set(['sys-org-unk', '', undefined, null]);
  if (a.org_id && !SYS_ORG.has(a.org_id)) return orgMap[a.org_id] || a.org || '—';
  return (a.org && a.org !== '—' && a.org !== '?') ? a.org : '—';
}

function listAssets(query) {
  const { tab, category, org, filial, status, search,
          no_responsible, no_inv, no_serial, stale_days, limit, page } = query;
  let items = stmts.selectActive.all().map(rowToAsset);

  // db.config.getOrgs() — реальный SQL-backed список организаций (Фаза
  // 7c-7). cfg.get('organizations') (lowdb) больше не обновляется с тех
  // пор, как orgs.repo.js переехал на SQL — использование lowdb здесь
  // было бы скрытым багом того же рода, что нашёлся в Фазе 7c-5.
  const orgMap = Object.fromEntries(db.config.getOrgs(true).map(o => [o.id, o.name]));
  const resolveOrgName = a => _resolveOrgName(a, orgMap);

  if (tab)      items = items.filter(a => a.tab === tab);
  if (category && category !== 'Все') items = items.filter(a => a.category === category);
  if (org      && org      !== 'Все') items = items.filter(a => resolveOrgName(a) === org);
  if (filial   && filial   !== 'Все') items = items.filter(a => a.filial === filial);
  if (status   && status   !== 'Все') items = items.filter(a => a.status === status);
  if (no_responsible === '1') items = items.filter(a => !a.responsible || a.responsible === '?' || a.responsible === '—');
  if (no_inv    === '1') items = items.filter(a => !a.inv    || a.inv    === '—');
  if (no_serial === '1') items = items.filter(a => !a.serial || a.serial === '—');
  if (stale_days) {
    const cutoff = new Date(Date.now() - parseInt(stale_days)*24*60*60*1000).toISOString();
    items = items.filter(a => !a.updated_at || a.updated_at < cutoff);
  }
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(a => {
      const metaStr = JSON.stringify(a.meta||{}).toLowerCase();
      return [a.responsible,a.model,a.serial,a.inv,a.location,a.org,a.note,a.type,a.category]
        .some(v => v && v.toLowerCase().includes(q)) || metaStr.includes(q);
    });
  }
  items.sort((a,b) =>
    (a.filial||'').localeCompare(b.filial||'') ||
    (a.location||'').localeCompare(b.location||'') ||
    (a.model||'').localeCompare(b.model||'')
  );

  const total = items.length;
  const lim   = Math.min(parseInt(limit) || 50, 200);
  const pg    = Math.max(parseInt(page)  || 1, 1);
  const pages = Math.ceil(total / lim) || 1;
  const slice = items.slice((pg - 1) * lim, pg * lim).map(a => ({
    ...a,
    org: resolveOrgName(a),
  }));

  return { items: slice, total, page: pg, pages, limit: lim };
}

function searchAssets(q) {
  const query = (q || '').trim().toLowerCase();
  if (!query || query.length < 2) return [];
  const FIELDS = ['model','serial','inv','responsible','org','filial','location','type','note'];
  const orgMap = Object.fromEntries(
    db.config.getOrgs(true).map(o => [o.id, o.name.toLowerCase()])
  );
  return stmts.selectActive.all().map(rowToAsset)
    .filter(a => FIELDS.some(f => (a[f]||'').toLowerCase().includes(query))
      || (a.org_id && (orgMap[a.org_id]||'').includes(query)))
    .slice(0, 100);
}

function getAssetById(id) {
  if (!id) return null;
  return rowToAsset(stmts.selectOne.get(id));
}

function createAsset(body, changedByStr) {
  const { tab='os', category='', filial='', address='', location='',
          responsible='', type='', model='', serial='', status='используется',
          org='', note='', inv='', meta={} } = body || {};
  if (!model) throw new Error('Model required');
  const now = new Date().toISOString();
  const id = uuidv7();

  const values = ASSET_COLS.map(col => {
    if (col === 'id') return id;
    if (col === 'created_at' || col === 'updated_at') return now;
    if (col === 'status') return status;
    if (col.startsWith('meta_')) return meta[col.slice(5)] ?? null;
    const plain = { tab, category, filial, address, location, responsible,
      type, model, serial, org, note, inv: inv || '' };
    return plain[col] !== undefined ? plain[col] : null;
  });

  const histEntry = { id:uuidv7(), asset_id:id,
    action_type:'add', date:now, from_who:'', to_who:responsible||'Склад',
    filial:filial||'', location:location||'',
    equipment:`${type} ${model}`, model, type, serial,
    reason:'Добавление в реестр', changed_by:changedByStr };

  sqlite.exec('BEGIN');
  try {
    stmts.insert.run(...values);
    stmts.historyInsert.run(histEntry.id, histEntry.asset_id, histEntry.action_type, histEntry.date,
      histEntry.from_who, histEntry.to_who, histEntry.filial, histEntry.location,
      histEntry.equipment, histEntry.model, histEntry.type, histEntry.serial,
      histEntry.reason, histEntry.changed_by);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return { id, ok:true };
}

function updateAsset(id, body, changedByStr) {
  const asset = stmts.selectOne.get(id);
  if (!asset) { const e = new Error('Not found'); e.notFound = true; throw e; }
  const now = new Date().toISOString();
  const { cols, vals } = buildUpdate(body || {});
  cols.push('updated_at = ?'); vals.push(now);

  const STATUS_LABELS = {
    'используется': 'Статус: Используется',
    'резерв':       'Статус: Резерв',
    'ремонт':       'Статус: Ремонт',
  };
  const newStatus = body && body.status;
  const needsHistory = newStatus && newStatus !== asset.status && newStatus !== 'списан';

  sqlite.exec('BEGIN');
  try {
    sqlite.prepare(`UPDATE assets SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id);
    if (needsHistory) {
      const histEntry = {
        id: uuidv7(), asset_id: id,
        action_type: 'status_change', date: now,
        from_who: asset.responsible || '',
        to_who:   (body.responsible !== undefined ? body.responsible : asset.responsible) || '',
        filial:   (body.filial   !== undefined ? body.filial   : asset.filial)   || '',
        location: (body.location !== undefined ? body.location : asset.location) || '',
        equipment: `${asset.type} ${asset.model}`,
        model: asset.model, type: asset.type, serial: asset.serial,
        reason: STATUS_LABELS[newStatus] || `Статус: ${newStatus}`,
        changed_by: changedByStr,
      };
      stmts.historyInsert.run(histEntry.id, histEntry.asset_id, histEntry.action_type, histEntry.date,
        histEntry.from_who, histEntry.to_who, histEntry.filial, histEntry.location,
        histEntry.equipment, histEntry.model, histEntry.type, histEntry.serial,
        histEntry.reason, histEntry.changed_by);
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return { ok:true };
}

function retireAsset(id, changedByStr) {
  const asset = stmts.selectOne.get(id);
  if (!asset) { const e = new Error('Not found'); e.notFound = true; throw e; }
  const retireNow = new Date().toISOString();
  const retireHist = { id:uuidv7(), asset_id:id,
    action_type:'retire', date:retireNow,
    from_who:asset.responsible, to_who:'',
    filial:asset.filial||'', location:asset.location||'',
    equipment:`${asset.type} ${asset.model}`, model:asset.model, type:asset.type, serial:asset.serial,
    reason:'Списание', changed_by:changedByStr };

  sqlite.exec('BEGIN');
  try {
    sqlite.prepare('UPDATE assets SET status = ?, updated_at = ? WHERE id = ?').run('списан', retireNow, id);
    stmts.historyInsert.run(retireHist.id, retireHist.asset_id, retireHist.action_type, retireHist.date,
      retireHist.from_who, retireHist.to_who, retireHist.filial, retireHist.location,
      retireHist.equipment, retireHist.model, retireHist.type, retireHist.serial,
      retireHist.reason, retireHist.changed_by);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return { ok:true };
}

function moveAsset(id, body, changedByStr) {
  const asset = stmts.selectOne.get(id);
  if (!asset) { const e = new Error('Not found'); e.notFound = true; throw e; }
  const { newResponsible, newOrg, newFilial, newAddress, newLocation, reason } = body || {};
  const now = new Date().toISOString();
  const pick = (newVal, old) => (newVal !== undefined && newVal !== null && newVal !== '') ? newVal : old;

  const nextResponsible = pick(newResponsible, asset.responsible);
  const nextOrg         = pick(newOrg,         asset.org);
  const nextFilial      = pick(newFilial,      asset.filial);
  const nextAddress     = pick(newAddress,     asset.address);
  const nextLocation    = pick(newLocation,    asset.location);

  const histReason = [
    reason || 'Перемещение',
    newOrg    && newOrg    !== asset.org    ? `орг: ${asset.org||'—'} → ${newOrg}`       : '',
    newFilial && newFilial !== asset.filial ? `филиал: ${asset.filial||'—'} → ${newFilial}` : '',
  ].filter(Boolean).join(' | ');

  sqlite.exec('BEGIN');
  try {
    sqlite.prepare('UPDATE assets SET responsible=?, org=?, filial=?, address=?, location=?, updated_at=? WHERE id=?')
      .run(nextResponsible, nextOrg, nextFilial, nextAddress, nextLocation, now, id);
    stmts.historyInsert.run(uuidv7(), id, 'move', now,
      asset.responsible || '', nextResponsible ?? '',
      nextFilial ?? '', nextLocation ?? '',
      `${asset.type} ${asset.model}`, asset.model, asset.type, asset.serial,
      histReason, changedByStr);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return { ok:true };
}

function bulkMoveAssets(body, changedByStr) {
  const { ids, newResponsible, newFilial, newAddress, newLocation, reason } = body || {};
  if (!Array.isArray(ids) || !ids.length) { const e = new Error('ids[] required'); e.badRequest = true; throw e; }

  const now = new Date().toISOString();
  const pick = (newVal, old) => (newVal !== undefined && newVal !== null && newVal !== '') ? newVal : old;
  // BUG-2: помимо счётчика ok/failed[] (старые поля, фронт их уже читает —
  // не трогаем), добавляем ids_assigned/ids_failed — точный список ID,
  // а не только количество, чтобы вызывающая сторона могла разобрать,
  // какие конкретно ассеты не обработались, а не только сколько их было.
  const results = { ok: 0, failed: [], ids_assigned: [], ids_failed: [] };

  sqlite.exec('BEGIN');
  try {
    ids.forEach(id => {
      const asset = stmts.selectOne.get(id);
      if (!asset) { results.failed.push(id); results.ids_failed.push({ id, reason: 'Ассет не найден' }); return; }

      const nextResponsible = pick(newResponsible, asset.responsible);
      const nextFilial      = pick(newFilial,      asset.filial);
      const nextAddress     = pick(newAddress,     asset.address);
      const nextLocation    = pick(newLocation,    asset.location);

      sqlite.prepare('UPDATE assets SET responsible=?, filial=?, address=?, location=?, updated_at=? WHERE id=?')
        .run(nextResponsible, nextFilial, nextAddress, nextLocation, now, id);

      const histReason = [
        reason || 'Массовое перемещение',
        newFilial      && newFilial !== asset.filial           ? `филиал: ${asset.filial||'—'} → ${newFilial}`               : '',
        newLocation    && newLocation !== asset.location       ? `место: ${asset.location||'—'} → ${newLocation}`             : '',
        newResponsible && newResponsible !== asset.responsible ? `ответственный: ${asset.responsible||'—'} → ${newResponsible}` : '',
      ].filter(Boolean).join(' | ');

      stmts.historyInsert.run(uuidv7(), id, 'move', now,
        asset.responsible || '', nextResponsible ?? '',
        nextFilial ?? '', nextLocation ?? '',
        `${asset.type} ${asset.model}`, asset.model, asset.type, asset.serial,
        histReason, changedByStr);
      results.ok++;
      results.ids_assigned.push(id);
    });
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return results;
}

function bulkAssignInv(body, changedByStr) {
  const { ids, org_id, type_code } = body || {};
  if (!Array.isArray(ids) || !ids.length) { const e = new Error('ids[] required'); e.badRequest = true; throw e; }
  if (!org_id || !type_code) { const e = new Error('org_id и type_code обязательны'); e.badRequest = true; throw e; }

  const now = new Date().toISOString();
  let assigned = 0, skipped = 0;
  const idsAssigned = [];
  const idsFailed = []; // [{ id, reason }]
  const org = db.config.getOrg(org_id);

  // BUG-2: раньше цикл не был обёрнут в транзакцию — если nextInv() падал
  // на середине пачки (например, для этого типа не настроено правило),
  // уже обработанные ассеты оставались обновлёнными в SQL, а необработанные
  // (после точки сбоя) — нет, и вызывающая сторона получала голый 500
  // без единого слова о том, что вообще успело примениться. Теперь весь
  // батч — одна транзакция: ожидаемые «мягкие» причины пропуска (ассет не
  // найден, уже есть инв. номер, для типа не настроено правило) не рушат
  // остальную пачку — просто попадают в ids_failed с причиной; а по-
  // настоящему неожиданная ошибка (например, сбой самой БД) откатывает
  // всё целиком, а не оставляет пачку в частично применённом состоянии.
  sqlite.exec('BEGIN');
  try {
    for (const id of ids) {
      const asset = stmts.selectOne.get(id);
      if (!asset) { skipped++; idsFailed.push({ id, reason: 'Ассет не найден' }); continue; }
      if (asset.inv && asset.inv.trim()) { skipped++; idsFailed.push({ id, reason: 'Уже есть инв. номер' }); continue; }

      let inv;
      try {
        inv = db.config.nextInv(org_id, type_code.toUpperCase()).inv;
      } catch (e) {
        // Ожидаемая причина (например, "Тип X не настроен для Y") —
        // пропускаем этот конкретный ассет, не рушим всю пачку.
        skipped++; idsFailed.push({ id, reason: e.message });
        continue;
      }

      sqlite.prepare('UPDATE assets SET inv=?, org_id=?, org=?, updated_at=? WHERE id=?')
        .run(inv, org_id, (org && org.name) || asset.org || '', now, id);

      stmts.historyInsert.run(uuidv7(), id, 'inv_assigned', now,
        '', asset.responsible || '',
        asset.filial || '', asset.location || '',
        `${asset.type} ${asset.model}`, asset.model, asset.type, asset.serial,
        `Присвоен инв. номер: ${inv}`, changedByStr);
      assigned++;
      idsAssigned.push(id);
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }

  return { ok: true, assigned, skipped, ids_assigned: idsAssigned, ids_failed: idsFailed };
}

function reassignEmployeeAssets(employeeId, toEmployeeId, changedByStr) {
  const emp = db.getEmployee(employeeId);
  if (!emp) { const e = new Error('Сотрудник не найден'); e.notFound = true; throw e; }

  const assets = stmts.selectActive.all()
    .filter(a => a.responsible === emp.name);

  if (assets.length === 0) {
    return { ok: true, moved: 0, left_unassigned: 0 };
  }

  const now = new Date().toISOString();
  const toEmp = toEmployeeId ? db.getEmployee(toEmployeeId) : null;

  sqlite.exec('BEGIN');
  try {
    assets.forEach(asset => {
      const oldResp = asset.responsible;
      if (toEmployeeId && toEmp) {
        sqlite.prepare('UPDATE assets SET responsible=?, responsible_id=?, updated_at=? WHERE id=?')
          .run(toEmp.name, toEmp.id, now, asset.id);
        stmts.historyInsert.run(uuidv7(), asset.id, 'reassign', now,
          oldResp || '', toEmp.name,
          asset.filial || '', asset.location || '',
          `${asset.type} ${asset.model}`, asset.model, asset.type, asset.serial,
          `Переместить при увольнении ${emp.name}`, changedByStr);
      } else if (!toEmployeeId) {
        sqlite.prepare("UPDATE assets SET responsible='', responsible_id='', updated_at=? WHERE id=?")
          .run(now, asset.id);
        stmts.historyInsert.run(uuidv7(), asset.id, 'reassign', now,
          oldResp || '', 'Без ответственного',
          asset.filial || '', asset.location || '',
          `${asset.type} ${asset.model}`, asset.model, asset.type, asset.serial,
          `Оставлено без ответственного при увольнении ${emp.name}`, changedByStr);
      }
    });
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }

  return {
    ok: true,
    moved: toEmployeeId ? assets.length : 0,
    left_unassigned: !toEmployeeId ? assets.length : 0
  };
}

function getAllAssets() {
  // Все статусы (включая списанные) — нужно для CSV-экспорта/дедупликации
  // при импорте, в отличие от listAssets/searchAssets, которые по
  // умолчанию скрывают списанные.
  return stmts.selectAll.all().map(rowToAsset);
}

function bulkImportAssets(assetsArray, changedByStr) {
  if (!assetsArray.length) return;
  const now2 = new Date().toISOString();
  sqlite.exec('BEGIN');
  try {
    for (const item of assetsArray) {
      const values = ASSET_COLS.map(col => {
        if (col.startsWith('meta_')) return (item.meta && item.meta[col.slice(5)]) ?? null;
        return item[col] !== undefined ? item[col] : null;
      });
      stmts.insert.run(...values);
      stmts.historyInsert.run(
        uuidv7(), item.id, 'import', now2, '', item.responsible || 'Склад',
        item.filial || '', item.location || '',
        `${item.type} ${item.model}`, item.model, item.type, item.serial,
        item.inv ? `Импорт CSV · инв.№ ${item.inv}` : 'Импорт CSV', changedByStr
      );
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
}

module.exports = {
  listAssets, searchAssets, getAssetById, createAsset, updateAsset,
  retireAsset, moveAsset, bulkMoveAssets, bulkAssignInv, reassignEmployeeAssets,
  getAllAssets, bulkImportAssets,
};
