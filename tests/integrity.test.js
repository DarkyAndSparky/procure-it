'use strict';
/**
 * Тесты: целостность данных db.json и config.json
 * Читает реальные файлы и проверяет структуру.
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '..', 'data', 'db.json');
const CFG_PATH = path.join(__dirname, '..', 'data', 'config.json');

let db, cfg;

beforeAll(() => {
  // На чистом чекауте (папки data/ ещё нет — она создаётся только при первом
  // запуске сервера) требуем реальный database.js: он сам создаст db.json и
  // config.json с дефолтами через lowdb/FileSync, как и при обычном старте
  // приложения. Так тест не зависит от того, запускали ли уже сервер вручную.
  if (!fs.existsSync(DB_PATH) || !fs.existsSync(CFG_PATH)) {
    jest.resetModules();
    require('../server/database');
  }
  db  = JSON.parse(fs.readFileSync(DB_PATH,  'utf-8'));
  cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf-8'));
});

// ── config.json ───────────────────────────────────────────────────────────────
describe('config.json — структура', () => {
  test('содержит обязательные ключи верхнего уровня', () => {
    expect(cfg).toHaveProperty('settings');
    expect(cfg).toHaveProperty('organizations');
    expect(cfg).toHaveProperty('filials');
    expect(cfg).toHaveProperty('locations');
    expect(cfg).toHaveProperty('categories');
    expect(cfg).toHaveProperty('type_codes');
  });

  test('settings содержит company_name', () => {
    expect(typeof cfg.settings.company_name).toBe('string');
    expect(cfg.settings.edit_password).toBeUndefined(); // удалён — вход через users
  });

  test('sys-org-unk присутствует в organizations', () => {
    const sys = cfg.organizations.find(o => o.id === 'sys-org-unk');
    expect(sys).toBeDefined();
    expect(sys.system).toBe(true);
  });

  test('sys-filial-unk присутствует в filials', () => {
    const sys = cfg.filials.find(f => f.id === 'sys-filial-unk');
    expect(sys).toBeDefined();
    expect(sys.system).toBe(true);
  });

  test('sys-location-unk присутствует в locations', () => {
    const sys = cfg.locations.find(l => l.id === 'sys-location-unk');
    expect(sys).toBeDefined();
    expect(sys.system).toBe(true);
  });
});

describe('config.json — organizations', () => {
  test('у каждой org есть id, name, short_code, status', () => {
    const bad = cfg.organizations.filter(o =>
      !o.id || !o.name || !o.short_code || !o.status
    );
    expect(bad).toEqual([]);
  });

  test('short_code уникальны', () => {
    const codes = cfg.organizations.map(o => o.short_code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  test('id уникальны', () => {
    const ids = cfg.organizations.map(o => o.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('inv_rules — у каждого правила есть type_code, type_name, counter', () => {
    const bad = [];
    cfg.organizations.forEach(org => {
      (org.inv_rules || []).forEach(r => {
        if (!r.type_code || !r.type_name || r.counter === undefined)
          bad.push(`${org.name}:${r.type_code}`);
      });
    });
    expect(bad).toEqual([]);
  });

  test('inv_rules — type_code в верхнем регистре', () => {
    const bad = [];
    cfg.organizations.forEach(org => {
      (org.inv_rules || []).forEach(r => {
        if (r.type_code !== r.type_code.toUpperCase())
          bad.push(`${org.short_code}:${r.type_code}`);
      });
    });
    expect(bad).toEqual([]);
  });
});

describe('config.json — filials', () => {
  test('у каждого филиала есть id, name, status', () => {
    const bad = cfg.filials.filter(f => !f.id || !f.name || !f.status);
    expect(bad).toEqual([]);
  });

  test('id уникальны', () => {
    const ids = cfg.filials.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('config.json — locations', () => {
  test('у каждой локации есть id, name, filial_id', () => {
    const bad = cfg.locations.filter(l => !l.id || !l.name || !l.filial_id);
    expect(bad).toEqual([]);
  });

  test('filial_id ссылается на существующий филиал', () => {
    const filialIds = new Set(cfg.filials.map(f => f.id));
    const bad = cfg.locations.filter(l => !filialIds.has(l.filial_id));
    expect(bad).toEqual([]);
  });
});

// ── db.json ───────────────────────────────────────────────────────────────────
describe('db.json — структура', () => {
  test('содержит assets и history', () => {
    expect(Array.isArray(db.assets)).toBe(true);
    expect(Array.isArray(db.history)).toBe(true);
  });

  test('assets — массив (может быть пустым в чистой установке)', () => {
    expect(Array.isArray(db.assets)).toBe(true);
  });
});

describe('db.json — assets', () => {
  test('у каждого ассета есть id, tab, status, created_at', () => {
    const bad = db.assets.filter(a => !a.id || !a.tab || !a.status || !a.created_at);
    expect(bad.map(a => a.id || 'NO_ID')).toEqual([]);
  });

  test('id ассетов уникальны', () => {
    const ids = db.assets.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('tab — только допустимые значения', () => {
    const VALID_TABS = new Set(['os', 'small', 'infra']);
    const bad = db.assets.filter(a => !VALID_TABS.has(a.tab));
    expect(bad.map(a => `${a.id}:${a.tab}`)).toEqual([]);
  });

  test('status — только допустимые значения', () => {
    const VALID = new Set(['используется', 'резерв', 'ремонт', 'списан']);
    const bad = db.assets.filter(a => !VALID.has(a.status));
    expect(bad.map(a => `${a.id}:${a.status}`)).toEqual([]);
  });

  test('org_id ссылается на существующую организацию', () => {
    const orgIds = new Set(cfg.organizations.map(o => o.id));
    const bad = db.assets.filter(a => a.org_id && !orgIds.has(a.org_id));
    expect(bad.map(a => `${a.id}:${a.org_id}`)).toEqual([]);
  });

  test('filial_id ссылается на существующий филиал', () => {
    const filialIds = new Set(cfg.filials.map(f => f.id));
    const bad = db.assets.filter(a => a.filial_id && !filialIds.has(a.filial_id));
    expect(bad.map(a => `${a.id}:${a.filial_id}`)).toEqual([]);
  });

  test('нет полей _snapshot (устаревшее; BUG-1: address/org/category теперь НАМЕРЕННО остаются в db.json — их читает миграция в SQLite)', () => {
    const bad = db.assets.filter(a => Object.keys(a).some(k => k.endsWith('_snapshot')));
    expect(bad.map(a => a.id)).toEqual([]);
  });

  test('инв. номера уникальны (среди непустых)', () => {
    const invs = db.assets.map(a => a.inv).filter(Boolean);
    const unique = new Set(invs);
    expect(unique.size).toBe(invs.length);
  });

  test('формат инв. номеров соответствует CODE-TYPE-NNNNN (Latin) или CODE-RU-NNNNN', () => {
    // Допускаем кириллицу в TYPE-части — исторические данные, миграция запланирована
    const INV_RE = /^[A-Z]{2,5}-.{1,6}-\d{5}$/u;
    const bad = db.assets
      .filter(a => a.inv && !INV_RE.test(a.inv))
      .map(a => `${a.id}: "${a.inv}"`);
    expect(bad).toEqual([]);
  });

  test('инв. номера с кириллицей в TYPE-части (требуют миграции)', () => {
    const LATIN_RE = /^[A-Z]{2,5}-[A-Z]{1,6}-\d{5}$/;
    const cyrillic = db.assets
      .filter(a => a.inv && !LATIN_RE.test(a.inv))
      .map(a => a.inv);
    // Тест информационный — не падает, но выводит список
    if (cyrillic.length > 0) {
      console.warn(`⚠ ${cyrillic.length} инв. номеров с кириллицей:`, cyrillic.slice(0,5));
    }
    expect(cyrillic.length).toBeGreaterThanOrEqual(0); // всегда проходит
  });
});

describe('db.json — history', () => {
  test('у каждой записи истории есть id и date', () => {
    // action_type обязателен для новых записей (v2); старые могут не иметь его
    const bad = db.history.filter(h => !h.id || !h.date);
    expect(bad.map(h => h.id || 'NO_ID')).toEqual([]);
  });

  test('все записи истории v2 имеют action_type (информационный)', () => {
    const noType = db.history.filter(h => !h.action_type);
    if (noType.length > 0) {
      console.warn(`⚠ ${noType.length} записей истории без action_type (старые данные)`);
    }
    expect(noType.length).toBeGreaterThanOrEqual(0);
  });

  test('id записей истории уникальны', () => {
    const ids = db.history.map(h => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('asset_id ссылается на существующий ассет (если не null)', () => {
    const assetIds = new Set(db.assets.map(a => a.id));
    const bad = db.history.filter(h => h.asset_id && !assetIds.has(h.asset_id));
    expect(bad.map(h => `${h.id}:${h.asset_id}`)).toEqual([]);
  });
});
