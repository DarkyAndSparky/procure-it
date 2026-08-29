/**
 * database.js v2
 *
 * Фаза 1 рефакторинга: создание lowdb-инстансов и дефолты переехали
 * в server/db/store.js. Здесь остаётся композиция методов — форма
 * module.exports (db.config.*, db.getUser и т.д.) не меняется.
 *
 * Два файла данных:
 *   data/config.json  — справочники (orgs, filials, locations, accounts, settings)
 *   data/db.json      — рабочие данные (assets, history)
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { db, cfg, TYPE_CODES_MAP } = require('./db/store');
const { sqlite } = require('./db/sqlite');

const orgsRepo       = require('./repositories/orgs.repo');
const filialsRepo    = require('./repositories/filials.repo');
const locationsRepo  = require('./repositories/locations.repo');
const accountsRepo   = require('./repositories/accounts.repo');
const employeesRepo  = require('./repositories/employees.repo');
const settingsRepo   = require('./repositories/settings.repo');
const usersRepo      = require('./repositories/users.repo');

// ─── Методы: Сотрудники ───────────────────────────────────────────────────────
db.getEmployees     = employeesRepo.getEmployees;
db.getEmployee      = employeesRepo.getEmployee;
db.createEmployee   = employeesRepo.createEmployee;
db.updateEmployee   = employeesRepo.updateEmployee;
db.deleteEmployee   = employeesRepo.deleteEmployee;
db.searchEmployees  = employeesRepo.searchEmployees;

Object.defineProperty(db, 'ORG_CODES',  { get: settingsRepo.getOrgCodesMap,  enumerable: true });
Object.defineProperty(db, 'TYPE_CODES', { get: settingsRepo.getTypeCodesMap, enumerable: true });

// ─── Прямые методы для settings и categories (v2 API) ────────────────────────

db.getSettings    = settingsRepo.getSettings;
db.getSetting     = settingsRepo.getSetting;
db.setSetting     = settingsRepo.setSetting;
db.getCategories  = settingsRepo.getCategories;
db.setCategories  = settingsRepo.setCategories;
db.getTypeCodes   = settingsRepo.getTypeCodes;
db.setTypeCodes   = settingsRepo.setTypeCodes;

// ─── db.config — методы для справочников ──────────────────────────────────────

db.config = {

  ...orgsRepo,
  ...accountsRepo,
  ...filialsRepo,
  ...locationsRepo,
  // ── Экспорт / импорт конфига ─────────────────────────────────────────────────

  // Фаза 7c-8b: organizations/filials/locations/categories/type_codes/
  // settings/users всё уже в SQLite (Фазы 7c-2..7c-7) — exportConfig()/
  // diffConfig()/applyImport() ниже читали/писали через cfg (lowdb),
  // которая с тех пор не обновляется. Реальный баг, найден и исправлен
  // попутно с миграцией assets/history (не было тестов на эту фичу
  // экспорта/импорта конфига между инстансами — молча деградировала).
  exportConfig() {
    return {
      _meta:         cfg.get('_meta').value(),
      settings:      { company_name: settingsRepo.getSetting('company_name') },
      organizations: orgsRepo.getOrgs(true),
      filials:       filialsRepo.getFilials(true),
      locations:     locationsRepo.getLocations(null, true),
      categories:    settingsRepo.getCategories(),
      type_codes:    settingsRepo.getTypeCodes(),
      // пользователи без паролей, аккаунты не экспортируем
      users: usersRepo.getUsers(false).map(({ pin, ...u }) => u),
    };
  },

  diffConfig(incoming) {
    const conflicts = [];
    const clean = { organizations:[], filials:[], locations:[] };
    const getCurrent = {
      organizations: () => orgsRepo.getOrgs(true),
      filials:       () => filialsRepo.getFilials(true),
      locations:     () => locationsRepo.getLocations(null, true),
    };

    for (const level of ['organizations','filials','locations']) {
      const current       = getCurrent[level]();
      const byId          = Object.fromEntries(current.map(r => [r.id, r]));
      const byCode        = level === 'organizations'
        ? Object.fromEntries(current.filter(o=>o.short_code).map(o=>[o.short_code,o]))
        : {};
      const byName        = Object.fromEntries(
        current.map(r => [(r.name||'').toLowerCase(), r])
      );

      for (const rec of (incoming[level] || [])) {
        if (rec.system) continue;

        const matchId   = byId[rec.id];
        const matchCode = level === 'organizations' ? byCode[rec.short_code] : null;
        const matchName = byName[(rec.name||'').toLowerCase()];

        if (matchId && matchId.name === rec.name &&
            (!matchCode || matchCode.id === rec.id)) {
          clean[level].push(rec);
          continue;
        }

        const conflictType = matchId   ? 'same_id_diff_data'
                           : matchCode ? 'same_code'
                           : matchName ? 'same_name'
                           : null;
        if (!conflictType) { clean[level].push(rec); continue; }

        conflicts.push({
          level,
          incoming: rec,
          current: matchId || matchCode || matchName,
          type: conflictType,
          options: conflictType === 'same_id_diff_data'
            ? ['keep_current','replace']
            : ['skip','rename','replace'],
        });
      }
    }
    return { clean, conflicts };
  },

  applyImport(clean, resolutions, incoming, changedBy = 'system') {
    const now = new Date().toISOString();
    const summary = { added:[], updated:[], skipped:[] };

    // Апсерт по id напрямую в SQL — не через orgsRepo.createOrg()/etc,
    // потому что те всегда генерируют новый uuidv7 при создании, а здесь
    // нужно сохранить ИМЕННО входящий id (кросс-инстанс синхронизация:
    // одна и та же организация должна иметь одинаковый id в обеих базах).
    // org_inv_rules намеренно не трогаем при апсерте организаций — нет
    // тестового покрытия и однозначной семантики "как мержить дочерние
    // правила при синхронизации", отдельная задача не по этой миграции.
    const upsert = {
      organizations: sqlite.prepare(`
        INSERT INTO organizations (id, name, short_code, status, system, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_code=excluded.short_code, status=excluded.status
      `),
      filials: sqlite.prepare(`
        INSERT INTO filials (id, name, address, org_id, status, system, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, address=excluded.address, org_id=excluded.org_id, status=excluded.status
      `),
      locations: sqlite.prepare(`
        INSERT INTO locations (id, name, filial_id, type, status, system, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, filial_id=excluded.filial_id, type=excluded.type, status=excluded.status
      `),
    };
    const existsCheck = {
      organizations: id => !!orgsRepo.getOrg(id),
      filials:       id => !!filialsRepo.getFilial(id),
      locations:     id => !!locationsRepo.getLocation(id),
    };
    const runUpsert = (level, r) => {
      if (level === 'organizations') upsert.organizations.run(r.id, r.name, r.short_code||'', r.status||'active', r.created_at||now);
      if (level === 'filials')       upsert.filials.run(r.id, r.name, r.address||'', r.org_id||null, r.status||'active', r.created_at||now);
      if (level === 'locations')     upsert.locations.run(r.id, r.name, r.filial_id||null, r.type||'office', r.status||'active', r.created_at||now);
    };

    for (const level of ['organizations','filials','locations']) {
      for (const r of (clean[level] || [])) {
        const already = existsCheck[level](r.id);
        runUpsert(level, r);
        summary[already ? 'updated' : 'added'].push(`${level}:${r.id}`);
      }
    }

    for (const res of (resolutions || [])) {
      const { level, incoming_id, action, new_name } = res;
      const rec = (incoming[level]||[]).find(r => r.id === incoming_id);
      if (!rec) continue;

      if (action === 'skip' || action === 'keep_current') {
        summary.skipped.push(`${level}:${incoming_id}`);
        continue;
      }
      if (action === 'replace') {
        runUpsert(level, rec);
        summary.updated.push(`${level}:${incoming_id}`);
      }
      if (action === 'rename' && new_name) {
        runUpsert(level, { ...rec, name: new_name, id: uuidv7() });
        summary.added.push(`${level}:${incoming_id}(renamed→${new_name})`);
      }
    }

    // Применяем categories и type_codes если переданы
    if (incoming.categories && typeof incoming.categories === 'object') {
      Object.entries(incoming.categories).forEach(([tab, items]) => settingsRepo.setCategories(tab, items));
      summary.updated.push('categories');
    }
    if (Array.isArray(incoming.type_codes) && incoming.type_codes.length) {
      settingsRepo.setTypeCodes(incoming.type_codes);
      summary.updated.push('type_codes');
    }
    // settings.company_name если передан
    if (incoming.settings?.company_name) {
      settingsRepo.setSetting('company_name', incoming.settings.company_name);
      summary.updated.push('settings');
    }

    sqlite.prepare(
      `INSERT INTO history (id, asset_id, action_type, date, from_who, to_who, filial, location, equipment, model, type, serial, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuidv7(), null, 'config_imported', now,
      '', '', '', '', 'config.json', '', '', '',
      'Импорт конфигурации', changedBy);

    return summary;
  },
};

// ─── Экспорт ─────────────────────────────────────────────────────────────────


// ─── ПОЛЬЗОВАТЕЛИ СИСТЕМЫ ────────────────────────────────────────────────────

db.getUsers     = usersRepo.getUsers;
db.getUser      = usersRepo.getUser;
db.authUser     = usersRepo.authUser;
db.authByLogin  = usersRepo.authByLogin;
db.createUser   = usersRepo.createUser;
db.updateUser   = usersRepo.updateUser;
db.deleteUser   = usersRepo.deleteUser;

module.exports = db;
Object.defineProperty(module.exports, 'cfg', { get(){ return cfg; }, enumerable:true });
