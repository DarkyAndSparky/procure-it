/**
 * server/db/store.js
 *
 * Фаза 1 рефакторинга: вынос создания lowdb-инстансов и их дефолтов
 * из database.js. Поведение не меняется — просто отдельный модуль.
 *
 * Два файла данных:
 *   data/config.json  — справочники (orgs, filials, locations, accounts, settings)
 *   data/db.json      — рабочие данные (assets, history)
 */
'use strict';

const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path     = require('path');
const fs       = require('fs');
const logger    = require('../logger');

// ─── Пути ────────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.IT_ASSETS_DATA_DIR
  ? path.resolve(process.env.IT_ASSETS_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'db.json');
const CFG_PATH = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Словарь типов устройств (фоллбэк — если config.json ещё пуст) ───────────

// [code]: [name, tab]  tab: os | small | infra
const TYPE_CODES_MAP = {
  'NB' :['Ноутбук',          'os'   ],
  'PC' :['Системный блок',   'os'   ],
  'MON':['Монитор',          'os'   ],
  'MFU':['МФУ',              'os'   ],
  'PR' :['Принтер',          'os'   ],
  'TAB':['Планшет',          'small'],
  'TV' :['Телевизор',        'os'   ],
  'UPS':['ИБП',              'infra'],
  'MPC':['Мини ПК',          'os'   ],
  'SRV':['Сервер',           'infra'],
  'SW' :['Коммутатор',       'infra'],
  'RT' :['Маршрутизатор',    'infra'],
  'AP' :['Точка доступа',    'infra'],
  'CAM':['Камера',           'infra'],
  'DVR':['Видеорегистратор', 'infra'],
  'TSD':['ТСД',              'small'],
  'SPK':['Спикерфон',        'small'],
  'SPB':['Колонки',          'small'],
  'RBR':['Радиомост',        'infra'],
  'CPB':['Вызывная панель',  'infra'],
  'VDI':['Видеодомофон',     'infra'],
  'SCN':['Сканер',           'small'],
  'MOU':['Мышь',             'small'],
  'KB' :['Клавиатура',       'small'],
  'HS' :['Гарнитура',        'small'],
  'CAB':['Кабель/Патч-корд', 'small'],
  'POE':['PoE инжектор',     'infra'],
  'HUB':['USB-hub',          'small'],
  'SSD':['SSD/HDD',          'small'],
  'PHN':['Смартфон',         'small'],
  'WEB':['Web камера',       'small'],
  'SPF':['Сетевой фильтр',   'small'],
  'BRC':['Кронштейн',        'small'],
};

// ─── Два экземпляра lowdb ────────────────────────────────────────────────────

const db  = low(new FileSync(DB_PATH));
const cfg = low(new FileSync(CFG_PATH));

// ─── Системные UNK-заглушки (создаются если отсутствуют) ─────────────────────

const NOW = new Date().toISOString();

const SYS_ORG = {
  id:'sys-org-unk', name:'—', short_code:'UNK', status:'active',
  system:true, inv_rules:[], created_at:NOW, renamed_from:null, renamed_at:null,
};
const SYS_FILIAL = {
  id:'sys-filial-unk', name:'—', address:'', org_id:null,
  status:'active', system:true, created_at:NOW, closed_at:null,
};
const SYS_LOCATION = {
  id:'sys-location-unk', name:'—', type:'other',
  filial_id:'sys-filial-unk', status:'active', system:true,
  created_at:NOW, closed_at:null,
};

// ─── Defaults config.json ────────────────────────────────────────────────────

cfg.defaults({
  _meta:   { version:2, created_at:NOW },
  settings:{ company_name:'IT ASSETS' },
  accounts:[],
  organizations:[SYS_ORG],
  filials:  [SYS_FILIAL],
  locations:[SYS_LOCATION],
  employees:[], // ← справочник сотрудников
  users:[{id:'sys-user-admin',name:'admin',login:'admin',role:'admin',pin:'admn0000',active:true,created_at:'2026-01-01T00:00:00.000Z',email:''}],
  categories:{
    os:   ['Оборудование пользователей','Оргтехника','Мини ПК'],
    small:['Периферия','Гарнитуры','Колонки'],
    infra:['Сетевое оборудование','Wi-Fi','Принтеры','Видеонаблюдение','ИБП','Серверы'],
  },
  type_codes: Object.entries(TYPE_CODES_MAP).map(([code,[name,tab]])=>({code,name,tab:tab||'os'})),
}).write();

// Гарантируем наличие системных заглушек
function ensureSys(collection, sysRecord) {
  if (!cfg.get(collection).find({id: sysRecord.id}).value()) {
    cfg.get(collection).unshift(sysRecord).write();
    logger.info('DB', `added system ${sysRecord.id} to ${collection}`);
  }
}
ensureSys('organizations', SYS_ORG);
ensureSys('filials',       SYS_FILIAL);
ensureSys('locations',     SYS_LOCATION);

// ─── Defaults db.json ────────────────────────────────────────────────────────

db.defaults({
  _meta:   { version:2, created_at:NOW },
  assets:  [],
  history: [],
}).write();

// Гарантируем наличие системного пользователя admin
(function ensureAdminUser() {
  const users = cfg.get('users').value() || [];
  if (!users.find(u => u.id === 'sys-user-admin')) {
    cfg.set('users', [{id:'sys-user-admin',name:'admin',login:'admin',role:'admin',pin:'admn0000',active:true,created_at:NOW,email:''}, ...users]).write();
    logger.info('DB', 'создан системный пользователь admin');
  }
})();

// ─── Запуск миграций схемы ───────────────────────────────────────────────────
require('../migrate')(db, cfg);

module.exports = { db, cfg, TYPE_CODES_MAP, DATA_DIR, DB_PATH, CFG_PATH };
