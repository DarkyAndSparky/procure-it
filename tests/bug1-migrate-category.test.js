'use strict';
/**
 * Тесты: BUG-1 — server/migrate.js, v6 ("OLD_FIELDS") стирал 'category'
 * (и, как выяснилось при разборе, 'address'/'org' тоже) сразу после того,
 * как v5 их вычислила — а server/db/sqlite.js (Фаза 7c) читает именно эти
 * поля из db.json при первом переносе данных в SQLite, который выполняется
 * ПОСЛЕ migrate.js. Итог — 'category' терялась навсегда на любой свежей
 * миграции с реальными данными.
 *
 * Часть 1 — юнит-тест самого migrate.js на in-memory lowdb (без диска):
 * симулируем старые (v1) данные, гоняем миграцию, проверяем что category
 * реально ДОЖИВАЕТ до конца, а не стирается следом.
 *
 * Часть 2 — repairMissingCategories() в server/db/sqlite.js: для уже
 * смигрированных когда-то раньше установок (schema_version уже 7, полная
 * миграция не перезапустится) — чинит уже испорченные данные в SQLite.
 */
const low     = require('lowdb');
const Memory  = require('lowdb/adapters/Memory');
const runMigrations = require('../server/migrate');

describe('BUG-1 — migrate.js не стирает то, что вычислила v5', () => {
  test('category, вычисленная в v5, доживает до конца миграции (v1 → v7)', () => {
    const db = low(new Memory());
    const cfg = low(new Memory());

    db.defaults({
      _meta: {},
      assets: [
        // Старый формат (до v4/v5) — тип известен, category ещё нет
        { id: 'a1', tab: 'infra', type: 'Коммутатор', status: 'используется',
          filial: 'ГлавОфис', location: 'Стойка 1', org: 'ООО Ромашка',
          created_at: '2024-01-01T00:00:00.000Z' },
        { id: 'a2', tab: 'os', type: 'Ноутбук', status: 'используется',
          filial: 'ГлавОфис', location: 'Каб. 5', org: 'ООО Ромашка',
          created_at: '2024-01-01T00:00:00.000Z' },
      ],
      history: [],
    }).write();

    cfg.defaults({
      _meta: { schema_version: 1 },
      settings: {}, accounts: [], employees: [],
      organizations: [{ id: 'o1', name: 'ООО Ромашка', short_code: 'ROM' }],
      filials: [{ id: 'f1', name: 'ГлавОфис' }],
      locations: [],
      users: [{ id: 'u1', name: 'admin', login: 'admin', role: 'admin', pin: 'admn0000', active: true }],
      categories: {
        infra: ['Сетевое оборудование', 'ИБП'],
        os:    ['Оборудование пользователей', 'Оргтехника'],
        small: [],
      },
      type_codes: [],
    }).write();

    runMigrations(db, cfg);

    const assets = db.get('assets').value();
    const a1 = assets.find(a => a.id === 'a1');
    const a2 = assets.find(a => a.id === 'a2');

    // Главная проверка BUG-1: category не пустая и не удалена.
    expect(a1.category).toBe('Сетевое оборудование');
    expect(a2.category).toBe('Оборудование пользователей');

    // address/org тоже больше не удаляются (та же причина).
    expect(a1.org).toBe('ООО Ромашка');

    // А вот _snapshot — по-прежнему считается мёртвым полем и должен уйти.
    expect('_snapshot' in a1).toBe(false);

    expect(cfg.get('_meta.schema_version').value()).toBe(7);
  });
});

describe('BUG-1 (repair) — sqlite.js чинит уже испорченные установки', () => {
  test('repairMissingCategories восстанавливает category там, где она пустая, а type известен', () => {
    jest.resetModules();
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'it-assets-bug1-'));
    process.env.IT_ASSETS_DATA_DIR = tmpDir;

    try {
      const { sqlite, repairMissingCategories } = require('../server/db/sqlite');

      // Симулируем уже испорченный ассет: type известен, category пустая —
      // именно то состояние, в которое приводил старый баг.
      sqlite.exec('BEGIN');
      sqlite.prepare(
        `INSERT INTO assets (id, tab, category, type, status, created_at, updated_at)
         VALUES (?, 'infra', '', 'Коммутатор', 'используется', ?, ?)`
      ).run('broken-1', new Date().toISOString(), new Date().toISOString());
      sqlite.exec('COMMIT');

      // При старте модуля repair уже отработал один раз (до вставки строки
      // выше), поэтому вызываем его ещё раз явно — так же, как он
      // отработает при следующем перезапуске сервера на реальной, уже
      // испорченной ранее установке.
      repairMissingCategories();

      const row = sqlite.prepare('SELECT category FROM assets WHERE id = ?').get('broken-1');
      expect(row.category).toBe('Сетевое оборудование');
    } finally {
      delete process.env.IT_ASSETS_DATA_DIR;
    }
  });

  test('не трогает ассеты, у которых category уже заполнена', () => {
    jest.resetModules();
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'it-assets-bug1b-'));
    process.env.IT_ASSETS_DATA_DIR = tmpDir;

    try {
      const { sqlite, repairMissingCategories } = require('../server/db/sqlite');

      sqlite.exec('BEGIN');
      sqlite.prepare(
        `INSERT INTO assets (id, tab, category, type, status, created_at, updated_at)
         VALUES (?, 'infra', 'Ручная категория', 'Коммутатор', 'используется', ?, ?)`
      ).run('manual-1', new Date().toISOString(), new Date().toISOString());
      sqlite.exec('COMMIT');

      repairMissingCategories();

      const row = sqlite.prepare('SELECT category FROM assets WHERE id = ?').get('manual-1');
      expect(row.category).toBe('Ручная категория'); // не перезаписано
    } finally {
      delete process.env.IT_ASSETS_DATA_DIR;
    }
  });
});
