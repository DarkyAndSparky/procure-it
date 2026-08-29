'use strict';
/**
 * migrate.js — автоматическая миграция схемы при старте сервера.
 * Безопасно: каждый шаг идемпотентен (проверяет перед изменением).
 * Версия схемы хранится в config._meta.schema_version.
 */

const logger = require('./logger');

const CURRENT_VERSION = 7;

module.exports = function runMigrations(db, cfg) {
  const meta = cfg.get('_meta').value() || {};
  const from = meta.schema_version || 1;

  if (from >= CURRENT_VERSION) return; // уже актуально

  logger.info('migrate', `схема v${from} → v${CURRENT_VERSION}`);
  const log = (msg) => logger.info('migrate', msg);

  // ── v1 → v2: поле tab в type_codes ─────────────────────────────────────────
  if (from < 2) {
    const TAB_MAP = {
      'NB':'os','PC':'os','MON':'os','MFU':'os','PR':'os','TV':'os','MPC':'os',
      'TAB':'small','TSD':'small','SPK':'small','SPB':'small','SCN':'small',
      'MOU':'small','KB':'small','HS':'small','CAB':'small','HUB':'small',
      'SSD':'small','PHN':'small','WEB':'small','SPF':'small','BRC':'small',
      'UPS':'infra','SRV':'infra','SW':'infra','RT':'infra','AP':'infra',
      'CAM':'infra','DVR':'infra','RBR':'infra','CPB':'infra','VDI':'infra',
      'POE':'infra',
    };
    const codes = cfg.get('type_codes').value() || [];
    let changed = 0;
    const updated = codes.map(t => {
      if (!t.tab) { changed++; return { ...t, tab: TAB_MAP[t.code] || 'os' }; }
      return t;
    });
    if (changed > 0) {
      cfg.set('type_codes', updated).write();
      log(`v2: добавлено поле tab для ${changed} type_codes`);
    }
  }

  // ── v2 → v3: поле login в users ─────────────────────────────────────────────
  if (from < 3) {
    const users = cfg.get('users').value() || [];
    let changed = 0;
    const updated = users.map(u => {
      if (!u.login) {
        changed++;
        // Генерируем логин из имени: первое слово строчными
        const login = (u.name || 'user').split(/\s+/)[0].toLowerCase()
          .replace(/[^a-zа-яёa-z0-9]/gi, '');
        return { ...u, login };
      }
      return u;
    });
    if (changed > 0) {
      cfg.set('users', updated).write();
      log(`v3: добавлено поле login для ${changed} users`);
    }
  }

  // ── v3 → v4: filial_id / location_id / org_id в ассетах ────────────────────
  if (from < 4) {
    const assets  = db.get('assets').value() || [];
    const filials = cfg.get('filials').value() || [];
    const locs    = cfg.get('locations').value() || [];
    const orgs    = cfg.get('organizations').value() || [];

    // Индексы по имени
    const filialIdx = Object.fromEntries(
      filials.map(f => [f.name.trim().toLowerCase(), f.id])
    );
    const orgIdx = Object.fromEntries(
      orgs.map(o => [o.name.trim().toLowerCase(), o.id])
    );

    let changed = 0;
    const updated = assets.map(a => {
      let dirty = false;
      const patch = {};

      if (!a.filial_id) {
        const key = (a.filial || '').trim().toLowerCase();
        patch.filial_id = filialIdx[key] || 'sys-filial-unk';
        dirty = true;
      }
      if (!a.location_id) {
        const filialId = patch.filial_id || a.filial_id;
        const key = (a.location || '').trim().toLowerCase();
        const loc = locs.find(l =>
          l.filial_id === filialId &&
          l.name.trim().toLowerCase() === key
        );
        patch.location_id = loc ? loc.id : 'sys-location-unk';
        dirty = true;
      }
      if (!a.org_id) {
        const key = (a.org || '').trim().toLowerCase();
        patch.org_id = orgIdx[key] || 'sys-org-unk';
        dirty = true;
      }

      if (dirty) { changed++; return { ...a, ...patch }; }
      return a;
    });

    if (changed > 0) {
      db.set('assets', updated).write();
      log(`v4: проставлены filial_id/location_id/org_id для ${changed} ассетов`);
    }
  }

  // ── v4 → v5: category по типу устройства ────────────────────────────────────
  if (from < 5) {
    const TYPE_CAT_MAP = {
      // infra
      'коммутатор':'Сетевое оборудование','маршрутизатор':'Сетевое оборудование',
      'точка доступа':'Wi-Fi','радиомост':'Сетевое оборудование',
      'poe инжектор':'Сетевое оборудование','poe hub':'Сетевое оборудование',
      'видеорегистратор':'Видеонаблюдение','камера':'Видеонаблюдение',
      'вызывная панель':'Видеонаблюдение','видеодомофон':'Видеонаблюдение',
      'ибп':'ИБП','сервер':'Серверы',
      // os
      'мфу':'Оргтехника','принтер':'Оргтехника',
      'ноутбук':'Оборудование пользователей','системный блок':'Оборудование пользователей',
      'монитор':'Оборудование пользователей','телевизор':'Оборудование пользователей',
      'мини пк':'Мини ПК',
      // small
      'гарнитура':'Гарнитуры','наушники':'Гарнитуры','спикерфон':'Гарнитуры',
      'колонки':'Колонки','яндекс.станция':'Колонки',
    };

    const catsByTab = cfg.get('categories').value() ||
      { os:[], small:[], infra:[] };

    function resolveCategory(type, tab) {
      const key = (type || '').trim().toLowerCase();
      const mapped = TYPE_CAT_MAP[key];
      if (mapped) {
        const tabCats = catsByTab[tab] || [];
        if (tabCats.includes(mapped)) return mapped;
      }
      return (catsByTab[tab] || [])[0] || '';
    }

    const assets = db.get('assets').value() || [];
    let changed = 0;

    const updated = assets.map(a => {
      const expected = resolveCategory(a.type, a.tab);
      if (expected && a.category !== expected) {
        changed++;
        return { ...a, category: expected };
      }
      return a;
    });

    if (changed > 0) {
      db.set('assets', updated).write();
      log(`v5: пересчитана category для ${changed} ассетов`);
    }
  }

  // ── v6: фикс невалидных статусов + удаление устаревших полей ───────────────
  if (from < 6) {
    const VALID_STATUSES = new Set(['используется', 'резерв', 'ремонт', 'списан']);
    // Маппинг некорректных статусов в валидные
    const STATUS_MAP = {
      'Списать':     'списан',
      'Списан':      'списан',
      'СПИСАН':      'списан',
      'Резерв':      'резерв',
      'РЕЗЕРВ':      'резерв',
      'Используется':'используется',
      'ИСПОЛЬЗУЕТСЯ':'используется',
      'Ремонт':      'ремонт',
      'РЕМОНТ':      'ремонт',
    };
    // BUG-1: раньше здесь удалялись 'address', 'org', 'category' как якобы
    // устаревшие поля. Это неверно — server/db/sqlite.js (Фаза 7c) читает
    // ИМЕННО эти поля из db.json при первом переносе данных в SQLite, а
    // выполняется этот перенос ПОСЛЕ данной миграции (см. server/db/store.js:
    // сначала migrate(db, cfg), потом миграция в SQLite). Значит на любой
    // свежей миграции через v6 категория/адрес/организация каждого ассета
    // стирались ДО того, как SQLite успевал их прочитать — включая category,
    // которую только что вычислила v5 несколькими строками выше. Единственное
    // реально мёртвое поле здесь — '_snapshot' (нигде больше не читается,
    // не путать с history.org_snapshot — это другое, живое поле).
    const OLD_FIELDS = ['_snapshot'];

    const assets = db.get('assets').value() || [];
    let fixedStatus = 0;
    let fixedFields = 0;

    const updated = assets.map(a => {
      let changed = false;
      const patch = { ...a };

      // Фикс статуса
      if (!VALID_STATUSES.has(patch.status)) {
        const mapped = STATUS_MAP[patch.status];
        if (mapped) {
          patch.status = mapped;
          changed = true;
          fixedStatus++;
        }
      }

      // Удаление старых полей
      for (const f of OLD_FIELDS) {
        if (f in patch) {
          delete patch[f];
          changed = true;
          fixedFields++;
        }
      }

      return patch;
    });

    if (fixedStatus > 0 || fixedFields > 0) {
      db.set('assets', updated).write();
      if (fixedStatus > 0) log(`v6: исправлено статусов: ${fixedStatus}`);
      if (fixedFields > 0) log(`v6: удалено устаревших полей: ${fixedFields}`);
    } else {
      log('v6: данные уже чистые');
    }
  }

  // ── v6 → v7: хеширование PIN пользователей (bcrypt) ────────────────────────
  if (from < 7) {
    const { hashPin, isHashed, isEmpty } = require('./pin');
    const users = cfg.get('users').value() || [];
    let changed = 0;
    const updated = users.map(u => {
      if (isEmpty(u.pin) || isHashed(u.pin)) return u; // уже ок
      changed++;
      return { ...u, pin: hashPin(u.pin) };
    });
    if (changed > 0) {
      cfg.set('users', updated).write();
      log(`v7: захеширован PIN для ${changed} пользователей`);
    } else {
      log('v7: все PIN уже захешированы или пусты');
    }
  }

  // ── Обновляем версию схемы ───────────────────────────────────────────────────
  cfg.set('_meta.schema_version', CURRENT_VERSION)
     .set('_meta.migrated_at', new Date().toISOString())
     .write();

  log(`готово → schema_version=${CURRENT_VERSION}`);
};
