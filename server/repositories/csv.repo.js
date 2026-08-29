/**
 * server/repositories/csv.repo.js
 *
 * Фаза 4d рефакторинга (последний большой кусок): экспорт/импорт CSV
 * и импорт истории, вынесенные из index.js без изменения поведения.
 *
 * db — через require('../database') (мокаемый путь), см. комментарий
 * в assets.repo.js.
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const db = require('../database');
const assetsRepo = require('./assets.repo');
const { sqlite } = require('../db/sqlite');

const historyInsert = sqlite.prepare(
  `INSERT INTO history (id, asset_id, action_type, date, from_who, to_who, filial, location, equipment, model, type, serial, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

function exportCsv(tab) {
  let items = assetsRepo.getAllAssets().filter(a => a.status !== 'списан');
  if (tab) items = items.filter(a => a.tab === tab);
  items.sort((a,b) => (a.filial||'').localeCompare(b.filial||''));
  const headers = ['Инв. номер','Вкладка','Коллекция','Филиал','Расположение','Ответственный',
                   'Тип','Модель','Серийный №','Статус','Организация','Примечание',
                   'IP','MAC','Подсеть','WinBox/URL','Логин','Пароль','Hostname','Картриджи','Прошивка','ИНВ шкаф'];
  const csv = [headers, ...items.map(r => [
    r.inv||'',r.tab,r.category,r.filial,r.location,r.responsible,r.type,r.model,r.serial,r.status,r.org,r.note,
    r.meta?.ip||'',r.meta?.mac||'',r.meta?.subnet||'',r.meta?.winbox||r.meta?.controller||'',
    r.meta?.login||'',r.meta?.password||'',r.meta?.hostname||'',
    r.meta?.cartridge||'',r.meta?.firmware||'',r.meta?.cabinet||r.meta?.inv||''
  ])].map(r => r.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(';')).join('\n');
  return '\uFEFF' + csv;
}

// ─── Парсинг свободного текста "оборудование" из истории (Фаза: авто- ──────
// сопоставление серийников) ─────────────────────────────────────────────
//
// Реальные данные показывают, что один текст в истории часто описывает
// НЕСКОЛЬКО предметов через запятую ("Ноутбук ... SN ..., Монитор ... SN
// ..."), с непоследовательным форматированием серийника внутри каждого:
// - чаще всего явная метка SN/sn/SN:/sn: перед серийником
// - иногда без метки, серийник — последний таб-разделённый сегмент
// - иногда вообще без таба, серийник — последнее "слово" в тексте
// Сопоставление ниже безопасно по конструкции: угаданный кандидат
// принимается только если он ТОЧНО совпадает с serial реального актива в
// базе — ложное совпадение (например, "A4TECH HU-8" по ошибке принятое
// за кандидата) просто не найдёт пару и останется как раньше, без связи.

const SN_LABEL_RE = /\bsn\s*:?\s*([A-Za-zА-Яа-я0-9/-]{4,25})/i;

function looksLikeSerial(s) {
  return s.length >= 6 && s.length <= 25 && /\d/.test(s) && !s.includes(' ');
}

function extractSerialCandidate(item) {
  const m = SN_LABEL_RE.exec(item);
  if (m) return m[1].replace(/[.,]+$/, '');
  if (item.includes('\t')) {
    const last = item.split('\t').pop().trim().replace(/[.,]+$/, '');
    if (looksLikeSerial(last)) return last;
  }
  const lastWord = item.trim().replace(/[.,]+$/, '').split(' ').pop();
  if (looksLikeSerial(lastWord)) return lastWord;
  return null;
}

// Разбивает один текстовый блоб на отдельные позиции (по запятым) — не
// более 20 штук на всякий случай (защита от аномально длинной строки,
// которую разбило бы на сотни пустых фрагментов из-за опечатки в данных).
function splitEquipmentItems(text) {
  if (!text || !text.trim()) return [];
  return text.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
}

function importHistory(rows, changedByStr) {
  if (!Array.isArray(rows) || !rows.length) { const e = new Error('No data'); e.badRequest = true; throw e; }
  let added = 0, skipped = 0, matched = 0;
  const toAdd = [];

  // Индекс серийник -> актив, для сопоставления. getAllAssets() включает
  // и списанные — намеренно: перемещения в истории могли случиться до
  // списания, серийник актива на момент импорта истории не меняется.
  const serialIndex = new Map(
    assetsRepo.getAllAssets()
      .filter(a => a.serial && a.serial.trim())
      .map(a => [a.serial.trim().toUpperCase(), a])
  );

  const allHistory = sqlite.prepare('SELECT date, equipment, from_who FROM history').all();
  const existing = new Set(
    allHistory.map(h => `${h.date&&h.date.slice(0,10)}|${h.equipment&&h.equipment}|${h.from_who}`)
  );

  rows.forEach(r => {
    if (!r.date && !r.equipment) { skipped++; return; }

    let dateVal = r.date || new Date().toISOString();
    if (dateVal && /^\d{4,5}$/.test(dateVal.trim())) {
      const excelEpoch = new Date(1899, 11, 30);
      excelEpoch.setDate(excelEpoch.getDate() + parseInt(dateVal));
      dateVal = excelEpoch.toISOString().slice(0,10);
    }

    const items = splitEquipmentItems(r.equipment);
    // Пустой/неразбиваемый текст — старое поведение, одна запись без привязки.
    const effectiveItems = items.length ? items : [r.equipment || ''];

    effectiveItems.forEach(itemText => {
      const key = `${dateVal&&dateVal.slice(0,10)}|${itemText}|${r.from_who||''}`;
      if (existing.has(key)) { skipped++; return; }
      existing.add(key);

      const candidate = extractSerialCandidate(itemText);
      const asset = candidate ? serialIndex.get(candidate.toUpperCase()) : null;
      if (asset) matched++;

      toAdd.push({
        id: uuidv7(),
        asset_id: asset ? asset.id : (r.asset_id || ''),
        action_type: r.action_type || 'move',
        date: dateVal,
        from_who: r.from_who || '',
        to_who: r.to_who || '',
        filial: (asset && asset.filial) || r.filial || '',
        location: (asset && asset.location) || r.location || '',
        equipment: itemText,
        model: (asset && asset.model) || r.model || '',
        type: (asset && asset.type) || r.type || '',
        serial: (asset && asset.serial) || candidate || r.serial || '',
        reason: r.reason || 'Перемещение',
        changed_by: r.changed_by || changedByStr
      });
      added++;
    });
  });

  if (toAdd.length) {
    sqlite.exec('BEGIN');
    try {
      for (const h of toAdd) {
        historyInsert.run(h.id, h.asset_id, h.action_type, h.date, h.from_who, h.to_who,
          h.filial, h.location, h.equipment, h.model, h.type, h.serial, h.reason, h.changed_by);
      }
      sqlite.exec('COMMIT');
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  }
  return { ok:true, added, skipped, matched };
}

function previewCsvImport(rows) {
  if (!Array.isArray(rows) || !rows.length) { const e = new Error('No data'); e.badRequest = true; throw e; }

  const existingOrgs = db.config.getOrgs(true);
  const existingMap  = new Map(existingOrgs.map(o => [o.name.trim().toLowerCase(), o]));

  const unknownOrgs = new Map();
  rows.forEach(r => {
    const name = (r.org || '').trim();
    if (!name || name === '—' || name === '?') return;
    const key = name.toLowerCase();
    if (existingMap.has(key)) return;
    if (!unknownOrgs.has(key)) {
      unknownOrgs.set(key, { name, count: 0, example: `${r.type||''} ${r.model||''}`.trim() });
    }
    unknownOrgs.get(key).count++;
  });

  return { ok: true, unknown_orgs: [...unknownOrgs.values()], total_rows: rows.length };
}

function importCsv(rows, options, changedByStr) {
  if (!Array.isArray(rows) || !rows.length) { const e = new Error('No data'); e.badRequest = true; throw e; }
  let added = 0, skipped = 0;
  const skipReasons = { dupe_serial:0, dupe_key:0, no_model:0 };
  const now = new Date().toISOString();
  const allAssetsNow = assetsRepo.getAllAssets();
  const existingBySerial = new Set(allAssetsNow.map(a => a.serial).filter(s => s && s.trim() && !['−','-','—','–'].includes(s.trim())));
  const existingByKey = new Set(allAssetsNow
    .filter(a => !a.serial || !a.serial.trim())
    .map(a => `${a.model}|${a.filial}|${a.location}|${a.responsible}`.toLowerCase()));

  function resolveFilial(name) {
    if (!name || !name.trim()) return 'sys-filial-unk';
    const key = name.trim().toLowerCase();
    const existing = db.config.getFilials(true).find(f => f.name.trim().toLowerCase() === key);
    if (existing) return existing.id;
    const created = db.config.createFilial({ name: name.trim(), address: '' });
    return created.id;
  }

  function resolveLocation(name, filial_id) {
    if (!name || !name.trim()) return 'sys-location-unk';
    const key = name.trim().toLowerCase();
    const existing = db.config.getLocations(filial_id, true)
      .find(l => l.name.trim().toLowerCase() === key);
    if (existing) return existing.id;
    const created = db.config.createLocation({ name: name.trim(), filial_id, type: 'office' });
    return created.id;
  }

  const createOrgsAuto = options.create_orgs !== false;
  const orgCache = new Map();

  function resolveOrg(name) {
    if (!name || !name.trim() || ['—','?','-'].includes(name.trim())) return 'sys-org-unk';
    const key = name.trim().toLowerCase();
    if (orgCache.has(key)) return orgCache.get(key);

    const existing = db.config.getOrgs(true).find(o => o.name.trim().toLowerCase() === key);
    if (existing) { orgCache.set(key, existing.id); return existing.id; }

    if (!createOrgsAuto) { orgCache.set(key, 'sys-org-unk'); return 'sys-org-unk'; }

    let short_code = name.trim().replace(/[^A-ZА-ЯЁa-zа-яё0-9]/g,'').slice(0,5).toUpperCase() || 'ORG';
    const allOrgs  = db.config.getOrgs(true);
    let suffix = 1;
    while (allOrgs.find(o => o.short_code === short_code)) short_code = short_code.slice(0,4) + suffix++;
    try {
      const created = db.config.createOrg({ name: name.trim(), short_code });
      orgCache.set(key, created.id);
      return created.id;
    } catch(e) {
      const retry = db.config.getOrgs(true).find(o => o.name.trim().toLowerCase() === key);
      const id = retry ? retry.id : 'sys-org-unk';
      orgCache.set(key, id);
      return id;
    }
  }

  const createEmpAuto = options.create_employees !== false;
  const empCache = new Map();

  function resolveEmployee(name) {
    if (!name || !name.trim() || ['—','?','-'].includes(name.trim())) return '';
    const key = name.trim().toLowerCase();
    if (empCache.has(key)) return empCache.get(key);

    // Фаза 7c-8b: employees уже в SQLite с Фазы 7c-6 — cfg.get('employees')
    // (lowdb) больше не действует, тот же класс бага, что нашёлся в 7c-5
    // с паролем. Заодно чинится расхождение имени поля: тут раньше писали
    // 'department', а в реальной схеме сотрудников поле называется 'dept'.
    const existing = db.getEmployees(false)
      .find(e => e.name && e.name.trim().toLowerCase() === key);
    if (existing) { empCache.set(key, existing.id); return existing.id; }

    if (!createEmpAuto) { empCache.set(key, ''); return ''; }

    try {
      const newEmp = db.createEmployee({ name: name.trim(), dept: '', phone: '', email: '' });
      empCache.set(key, newEmp.id);
      return newEmp.id;
    } catch(e) {
      const retry = db.getEmployees(false)
        .find(e => e.name && e.name.trim().toLowerCase() === key);
      const id = retry ? retry.id : '';
      empCache.set(key, id);
      return id;
    }
  }

  const typeCodes = db.getTypeCodes();
  const typeTabMap = {};
  typeCodes.forEach(t => { typeTabMap[t.name.trim().toLowerCase()] = t.tab || 'os'; });

  const catsByTab = db.getCategories();

  const TYPE_CAT_MAP = {
    'коммутатор':'Сетевое оборудование','маршрутизатор':'Сетевое оборудование',
    'точка доступа':'Wi-Fi','радиомост':'Сетевое оборудование',
    'poe инжектор':'Сетевое оборудование','poe hub':'Сетевое оборудование',
    'видеорегистратор':'Видеонаблюдение','камера':'Видеонаблюдение',
    'ибп':'ИБП','сервер':'Серверы','nas':'Серверы',
    'вызывная панель':'Видеонаблюдение','видеодомофон':'Видеонаблюдение',
    'мфу':'Оргтехника','принтер':'Оргтехника','сканер штрихкода':'Оргтехника',
    'ноутбук':'Оборудование пользователей','системный блок':'Оборудование пользователей',
    'монитор':'Оборудование пользователей','телевизор':'Оборудование пользователей',
    'мини пк':'Мини ПК',
    'компьютерная мышь':'Периферия','клавиатура':'Периферия','usb-hub':'Периферия',
    'патч-корд':'Периферия','сетевой фильтр':'Периферия','адаптер':'Периферия',
    'кронштейн':'Периферия','ssd/hdd':'Периферия','web камера':'Периферия',
    'стилус':'Периферия','сумка':'Периферия','защитное стекло':'Периферия',
    'смартфон':'Периферия','планшет':'Периферия',
    'тсд':'Периферия','сканер':'Периферия',
    'гарнитура':'Гарнитуры','наушники':'Гарнитуры','спикерфон':'Гарнитуры',
    'колонки':'Колонки','яндекс.станция':'Колонки',
  };

  function resolveCategory(type, tab) {
    const typeKey = (type||'').trim().toLowerCase();
    const mapped  = TYPE_CAT_MAP[typeKey];
    if (mapped) {
      const tabCats = catsByTab[tab] || [];
      if (tabCats.includes(mapped)) return mapped;
    }
    const tabCats = catsByTab[tab] || [];
    return tabCats[0] || '';
  }

  const typeCodeMap = {};
  typeCodes.forEach(t => { typeCodeMap[t.name.trim().toLowerCase()] = t.code; });

  const IT_ORG_CODES = ['ит', 'it', 'ит-склад', 'its'];
  const allOrgs = db.config.getOrgs(true).filter(o => !o.system);
  const itOrg   = allOrgs.find(o => IT_ORG_CODES.includes((o.short_code||'').toLowerCase())) || null;

  function resolveTypeCode(typeName) {
    return typeCodeMap[(typeName||'').trim().toLowerCase()] || null;
  }

  function tryAssignInv(asset) {
    if (asset.inv && asset.inv.trim()) return asset.inv;
    let orgId = asset.org_id;
    if (!orgId || orgId === 'sys-org-unk') {
      if (itOrg) orgId = itOrg.id;
      else return '';
    }
    const org = db.config.getOrgs(true).find(o => o.id === orgId);
    if (!org || !org.inv_rules || !org.inv_rules.length) {
      if (itOrg && itOrg.id !== orgId && itOrg.inv_rules && itOrg.inv_rules.length) {
        orgId = itOrg.id;
      } else return '';
    }
    const typeCode = resolveTypeCode(asset.type);
    if (!typeCode) return '';
    try {
      const result = db.config.nextInv(orgId, typeCode, { reserve: true });
      if (orgId !== asset.org_id) {
        asset.org_id = orgId;
        asset.org    = (db.config.getOrgs(true).find(o=>o.id===orgId)||{}).name || asset.org;
      }
      return result.inv;
    } catch(e) { return ''; }
  }

  const toAdd = [];
  rows.forEach(r => {
    if (!r.model) { skipped++; skipReasons.no_model++; return; }
    if (r.serial && existingBySerial.has(r.serial)) { skipped++; skipReasons.dupe_serial++; return; }
    if (!r.serial) {
      const key = `${r.model}|${r.filial||''}|${r.location||''}|${r.responsible||''}`.toLowerCase();
      if (existingByKey.has(key)) { skipped++; skipReasons.dupe_key++; return; }
      existingByKey.add(key);
    }
    if (r.serial) existingBySerial.add(r.serial);

    const filial_id   = resolveFilial(r.filial);
    const location_id = resolveLocation(r.location, filial_id);
    const org_id      = resolveOrg(r.org);
    const responsible_id = resolveEmployee(r.responsible);
    const tab         = r.tab || 'os';
    const category    = r.category || resolveCategory(r.type, tab);

    const asset = { id:uuidv7(), inv:r.inv||'', tab, category,
      filial:r.filial||'', address:r.address||'', location:r.location||'',
      filial_id, location_id, org_id, responsible_id,
      responsible:r.responsible||'', type:r.type||'', model:r.model,
      serial:r.serial||'', status:r.status||'используется',
      org:r.org||'', note:r.note||'',
      meta:{ ip:r.ip||'', mac:r.mac||'', subnet:r.subnet||'',
             login:r.login||'', password:r.password||'',
             hostname:r.hostname||'', firmware:r.firmware||'', cabinet:r.cabinet||'' },
      created_at:now, updated_at:now };

    if (!asset.serial) {
      const autoInv = tryAssignInv(asset);
      if (autoInv) asset.inv = autoInv;
    }

    toAdd.push(asset);
    added++;
  });

  const inv_assigned = toAdd.filter(a => a.inv && a.inv.trim() && !a.serial).length;
  const created_orgs = [...orgCache.entries()]
    .filter(([,id]) => id !== 'sys-org-unk')
    .map(([name]) => name);

  if (toAdd.length) {
    assetsRepo.bulkImportAssets(toAdd, changedByStr);
  }

  return {
    ok: true, added, skipped, skipReasons, inv_assigned, created_orgs,
    message: skipped > 0
      ? `Добавлено: ${added}. Пропущено: ${skipped} (серийник уже есть: ${skipReasons.dupe_serial}, дубль без серийника: ${skipReasons.dupe_key}, нет модели: ${skipReasons.no_model})`
      : `Успешно добавлено: ${added} единиц оборудования`
  };
}

module.exports = { exportCsv, importHistory, previewCsvImport, importCsv };
