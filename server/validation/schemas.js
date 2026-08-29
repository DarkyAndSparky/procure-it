/**
 * server/validation/schemas.js
 *
 * SEC-9: схемы валидации входных данных (zod), по одному блоку на роут-группу.
 * Заполняется постепенно по подэтапам VAL-1…VAL-6 — не весь проект сразу.
 *
 * Правила, общие для всех схем в этом файле:
 *  - .trim() на строковых полях, где важен человеческий ввод (имя, логин,
 *    название) — чтобы " Иванов " и "Иванов" не считались разными записями.
 *  - Явные .max() на свободных текстовых полях — защита от абсурдно длинных
 *    значений (вставленный по ошибке огромный текст), не только от пустых.
 *  - Где старое поведение допускало пустую строку как валидное значение
 *    (например, PIN пуст — это фича viewer-логина без пароля, см. SEC-2),
 *    схема ЭТО СОХРАНЯЕТ, а не запрещает — задача SEC-9 добавить проверки,
 *    а не тихо изменить бизнес-правила, которые чинили в SEC-1..10.
 */
'use strict';

const { z } = require('zod');

// ─── Пользователи системы ──────────────────────────────────────────────────

const ROLES = ['admin', 'operator', 'viewer'];

// PIN может быть пустым (осознанно — viewer без пароля, SEC-2), но если
// не пустой — не короче 4 символов (это и раньше требовал фронт, теперь
// то же самое требование есть и на бэкенде, а не только в браузере).
const pinField = z.string()
  .max(100, 'Слишком длинный пароль')
  .refine(v => v === '' || v.length >= 4, { message: 'Пароль — минимум 4 символа (или пусто)' });

const createUserSchema = z.object({
  name:  z.string().trim().min(1, 'Имя обязательно').max(200, 'Слишком длинное имя'),
  login: z.string().trim().max(100, 'Слишком длинный логин').default(''),
  role:  z.enum(ROLES, { message: 'Роль должна быть admin, operator или viewer' }).default('operator'),
  pin:   pinField.default(''),
  email: z.string().trim().max(200, 'Слишком длинный email').default(''),
  can_view_accounts: z.coerce.boolean().default(false),
});

const updateUserSchema = z.object({
  name:  z.string().trim().min(1, 'Имя не может быть пустым').max(200, 'Слишком длинное имя').optional(),
  login: z.string().trim().max(100, 'Слишком длинный логин').optional(),
  role:  z.enum(ROLES, { message: 'Роль должна быть admin, operator или viewer' }).optional(),
  pin:   pinField.optional(),
  email: z.string().trim().max(200, 'Слишком длинный email').optional(),
  active: z.coerce.boolean().optional(),
  can_view_accounts: z.coerce.boolean().optional(),
});

// ─── Активы ─────────────────────────────────────────────────────────────

const ASSET_TABS   = ['os', 'small', 'infra'];
const ASSET_STATUS = ['используется', 'резерв', 'ремонт', 'списан'];

// Свободный текст (адрес, примечание и т.п.) — просто ограничиваем длину,
// не диктуем формат: это поля, которые заполняют руками, слишком строгая
// схема тут только мешала бы, а не защищала.
const freeText = (max, msg) => z.string().trim().max(max, msg).default('');
const freeTextOpt = (max, msg) => z.string().trim().max(max, msg).optional();

const createAssetSchema = z.object({
  tab:         z.enum(ASSET_TABS, { message: 'tab должен быть os, small или infra' }).default('os'),
  category:    freeText(100, 'Слишком длинная категория'),
  filial:      freeText(200, 'Слишком длинное название филиала'),
  address:     freeText(300, 'Слишком длинный адрес'),
  location:    freeText(200, 'Слишком длинное название локации'),
  responsible: freeText(200, 'Слишком длинное имя ответственного'),
  type:        freeText(100, 'Слишком длинный тип'),
  model:       z.preprocess(v => v ?? '', z.string().trim().min(1, 'Model required').max(300, 'Слишком длинное название модели')),
  serial:      freeText(200, 'Слишком длинный серийный номер'),
  status:      z.enum(ASSET_STATUS, { message: 'Недопустимый статус' }).default('используется'),
  org:         freeText(200, 'Слишком длинное название организации'),
  note:        freeText(2000, 'Слишком длинное примечание'),
  inv:         freeText(100, 'Слишком длинный инв. номер'),
  meta:        z.record(z.string(), z.any()).default({}),
});

const updateAssetSchema = z.object({
  tab:            z.enum(ASSET_TABS, { message: 'tab должен быть os, small или infra' }).optional(),
  category:       freeTextOpt(100, 'Слишком длинная категория'),
  filial:         freeTextOpt(200, 'Слишком длинное название филиала'),
  address:        freeTextOpt(300, 'Слишком длинный адрес'),
  location:       freeTextOpt(200, 'Слишком длинное название локации'),
  responsible:    freeTextOpt(200, 'Слишком длинное имя ответственного'),
  type:           freeTextOpt(100, 'Слишком длинный тип'),
  model:          z.string().trim().min(1, 'Model не может быть пустым').max(300, 'Слишком длинное название модели').optional(),
  serial:         freeTextOpt(200, 'Слишком длинный серийный номер'),
  status:         z.enum(ASSET_STATUS, { message: 'Недопустимый статус' }).optional(),
  org:            freeTextOpt(200, 'Слишком длинное название организации'),
  note:           freeTextOpt(2000, 'Слишком длинное примечание'),
  inv:            freeTextOpt(100, 'Слишком длинный инв. номер'),
  inv_prev:       freeTextOpt(100, 'Слишком длинный предыдущий инв. номер'),
  org_id:         freeTextOpt(100, 'Некорректный org_id'),
  filial_id:      freeTextOpt(100, 'Некорректный filial_id'),
  location_id:    freeTextOpt(100, 'Некорректный location_id'),
  responsible_id: freeTextOpt(100, 'Некорректный responsible_id'),
  meta:           z.record(z.string(), z.any()).optional(),
});

const moveAssetSchema = z.object({
  newResponsible: freeTextOpt(200, 'Слишком длинное имя ответственного'),
  newOrg:         freeTextOpt(200, 'Слишком длинное название организации'),
  newFilial:      freeTextOpt(200, 'Слишком длинное название филиала'),
  newAddress:     freeTextOpt(300, 'Слишком длинный адрес'),
  newLocation:    freeTextOpt(200, 'Слишком длинное название локации'),
  reason:         freeTextOpt(500, 'Слишком длинная причина'),
});

const idsArray = z.array(z.string().trim().min(1)).min(1, 'ids[] required').max(1000, 'Слишком много ID за один запрос (максимум 1000)');

const bulkMoveAssetsSchema = z.object({
  ids:            idsArray,
  newResponsible: freeTextOpt(200, 'Слишком длинное имя ответственного'),
  newFilial:      freeTextOpt(200, 'Слишком длинное название филиала'),
  newAddress:     freeTextOpt(300, 'Слишком длинный адрес'),
  newLocation:    freeTextOpt(200, 'Слишком длинное название локации'),
  reason:         freeTextOpt(500, 'Слишком длинная причина'),
});

const bulkAssignInvSchema = z.object({
  ids:       idsArray,
  org_id:    z.string().trim().min(1, 'org_id и type_code обязательны'),
  type_code: z.string().trim().min(1, 'org_id и type_code обязательны').max(20, 'Слишком длинный код типа'),
});

// ─── Учётные записи («Учётные записи» — хранилище логинов/паролей от
// оборудования, см. SEC-4) ─────────────────────────────────────────────

const createAccountSchema = z.object({
  name:     z.string().trim().min(1, 'Name required').max(200, 'Слишком длинное название'),
  login:    freeText(500, 'Слишком длинный логин'),
  password: freeText(500, 'Слишком длинный пароль'),
  note:     freeText(2000, 'Слишком длинное примечание'),
  category: freeText(100, 'Слишком длинная категория'),
});

const updateAccountSchema = z.object({
  name:     z.string().trim().min(1, 'Название не может быть пустым').max(200, 'Слишком длинное название').optional(),
  login:    freeTextOpt(500, 'Слишком длинный логин'),
  password: freeTextOpt(500, 'Слишком длинный пароль'),
  note:     freeTextOpt(2000, 'Слишком длинное примечание'),
  category: freeTextOpt(100, 'Слишком длинная категория'),
});

// ─── Сотрудники ─────────────────────────────────────────────────────────

const createEmployeeSchema = z.object({
  name:   z.preprocess(v => v ?? '', z.string().trim().min(1, 'ФИО обязательно').max(200, 'Слишком длинное ФИО')),
  dept:   freeText(200, 'Слишком длинное название отдела'),
  filial: freeText(200, 'Слишком длинное название филиала'),
  phone:  freeText(50,  'Слишком длинный телефон'),
  email:  freeText(200, 'Слишком длинный email'),
  note:   freeText(2000, 'Слишком длинное примечание'),
});

const updateEmployeeSchema = z.object({
  name:   z.string().trim().min(1, 'ФИО не может быть пустым').max(200, 'Слишком длинное ФИО').optional(),
  dept:   freeTextOpt(200, 'Слишком длинное название отдела'),
  filial: freeTextOpt(200, 'Слишком длинное название филиала'),
  phone:  freeTextOpt(50,  'Слишком длинный телефон'),
  email:  freeTextOpt(200, 'Слишком длинный email'),
  note:   freeTextOpt(2000, 'Слишком длинное примечание'),
  active: z.coerce.boolean().optional(),
});

const reassignAssetsSchema = z.object({
  to_employee_id: freeTextOpt(100, 'Некорректный to_employee_id'),
});

// ─── Оргструктура: организации, филиалы, локации, категории, коды типов ──

const invRuleFormat = z.string().trim().max(200, 'Слишком длинный формат').default('{org}-{type}-{N:05}');

const invRuleSchema = z.object({
  type_code: z.string().trim().min(1, 'type_code обязателен').max(20, 'Слишком длинный код типа'),
  type_name: freeText(200, 'Слишком длинное название типа'),
  format:    invRuleFormat,
});

const createOrgSchema = z.object({
  name:       z.string().trim().min(1, 'name и short_code обязательны').max(200, 'Слишком длинное название'),
  short_code: z.string().trim().min(1, 'name и short_code обязательны').max(20, 'Слишком длинный код'),
  inv_rules:  z.array(invRuleSchema).max(100, 'Слишком много правил').default([]),
});

const updateOrgSchema = z.object({
  name:       z.string().trim().min(1, 'Название не может быть пустым').max(200, 'Слишком длинное название').optional(),
  short_code: z.string().trim().min(1, 'Код не может быть пустым').max(20, 'Слишком длинный код').optional(),
  status:     freeTextOpt(50, 'Слишком длинный статус'),
});

const renameOrgSchema = z.object({
  newName:    z.string().trim().min(1, 'newName required').max(200, 'Слишком длинное название'),
  changedBy:  freeTextOpt(200, 'Слишком длинное имя'),
});

const liquidateOrgSchema = z.object({
  targetOrgId:  z.string().trim().min(1, 'targetOrgId required'),
  changedBy:    freeTextOpt(200, 'Слишком длинное имя'),
  renumberInv:  z.coerce.boolean().default(false),
});

const addInvRuleSchema = z.object({
  type_code: z.string().trim().min(1, 'type_code обязателен').max(20, 'Слишком длинный код типа'),
  type_name: freeText(200, 'Слишком длинное название типа'),
  format:    invRuleFormat,
});

const toggleInvRuleSchema = z.object({
  active: z.coerce.boolean().default(false),
});

const renameInvRuleSchema = z.object({
  type_name: z.string().trim().min(1, 'type_name обязателен').max(200, 'Слишком длинное название типа'),
});

const deleteInvRuleForceSchema = z.object({
  action:        z.enum(['reset', 'transfer'], { message: 'action required (reset|transfer)' }),
  targetTypeCode: freeTextOpt(20, 'Слишком длинный код типа'),
});

const createFilialSchema = z.object({
  name:    z.string().trim().min(1, 'name обязателен').max(200, 'Слишком длинное название'),
  address: freeText(300, 'Слишком длинный адрес'),
  org_id:  freeTextOpt(100, 'Некорректный org_id'),
});

const updateFilialSchema = z.object({
  name:    z.string().trim().min(1, 'Название не может быть пустым').max(200, 'Слишком длинное название').optional(),
  address: freeTextOpt(300, 'Слишком длинный адрес'),
  org_id:  freeTextOpt(100, 'Некорректный org_id'),
});

const closeFilialSchema = z.object({
  changedBy: freeTextOpt(200, 'Слишком длинное имя'),
});

const createLocationSchema = z.object({
  name:      z.string().trim().min(1, 'name и filial_id обязательны').max(200, 'Слишком длинное название'),
  filial_id: z.string().trim().min(1, 'name и filial_id обязательны'),
  type:      freeText(50, 'Слишком длинный тип').default('office'),
});

const updateLocationSchema = z.object({
  name:      z.string().trim().min(1, 'Название не может быть пустым').max(200, 'Слишком длинное название').optional(),
  filial_id: freeTextOpt(100, 'Некорректный filial_id'),
  type:      freeTextOpt(50, 'Слишком длинный тип'),
});

const setCategoriesSchema = z.object({
  categories: z.array(z.string().trim().max(100, 'Слишком длинное название категории'), { message: 'Array expected' })
    .max(500, 'Слишком много категорий'),
});

const typeCodeEntrySchema = z.object({
  code: z.string().trim().min(1, 'Код типа обязателен').max(20, 'Слишком длинный код типа'),
  name: freeText(200, 'Слишком длинное название типа'),
  tab:  z.enum(ASSET_TABS, { message: 'tab должен быть os, small или infra' }).default('os'),
});

const setTypeCodesSchema = z.object({
  codes: z.array(typeCodeEntrySchema, { message: 'Array expected' }).max(500, 'Слишком много типов'),
});

const reserveInvSchema = z.object({
  org_id: freeTextOpt(100, 'Некорректный org_id'),
  org:    freeTextOpt(20, 'Некорректный org'),
  type:   z.string().trim().min(1, 'type required').max(20, 'Слишком длинный тип'),
});

// ─── Настройки и конфиг ─────────────────────────────────────────────────

const putStylesSchema = z.object({
  styles: z.record(z.string(), z.any(), { message: 'object expected' }),
});

const putLogoSvgSchema = z.object({
  svg: z.string({ message: 'svg string expected' }),
}).superRefine((data, ctx) => {
  const val = data.svg.trim();
  const isSvg    = val.toLowerCase().startsWith('<svg');
  const isBase64 = val.startsWith('data:image/');
  const isEmpty  = val === '';
  if (!isSvg && !isBase64 && !isEmpty) {
    ctx.addIssue({ code: 'custom', path: ['svg'], message: 'Unsupported logo format. Expected SVG markup or image data URL.' });
  }
  if (val.length > 512 * 1024) {
    ctx.addIssue({ code: 'custom', path: ['svg'], message: 'Logo too large (max 512 KB)' });
  }
});

const putCompanyNameSchema = z.object({
  company_name: z.preprocess(v => v ?? '', z.string().trim().min(1, 'company_name required').max(200, 'Слишком длинное название')),
});

const putPasswordSchema = z.object({
  newPassword: z.preprocess(v => v ?? '', z.string().trim().min(4, 'newPassword required (минимум 4 символа)').max(100, 'Слишком длинный пароль')),
});

const importDiffSchema = z.object({
  config: z.record(z.string(), z.any(), { message: 'Ожидается { config: {...} }' }),
}).superRefine((data, ctx) => {
  const missing = ['organizations', 'filials', 'locations'].filter(k => !Array.isArray(data.config[k]));
  if (missing.length) {
    ctx.addIssue({ code: 'custom', path: ['config'], message: 'Отсутствуют поля: ' + missing.join(', ') });
  }
});

const importApplySchema = z.object({
  clean:       z.record(z.string(), z.any(), { message: 'Ожидается { clean, resolutions, incoming }' }),
  incoming:    z.record(z.string(), z.any(), { message: 'Ожидается { clean, resolutions, incoming }' }),
  resolutions: z.array(z.any()).default([]),
  changedBy:   freeTextOpt(200, 'Слишком длинное имя'),
});

// ─── CSV-импорт (см. также лимит в 5000 строк, SEC-8) ────────────────────
// Каждая строка — объект с произвольными колонками (заголовки CSV на
// стороне клиента заранее не фиксированы), поэтому схема не диктует набор
// полей внутри строки — только что это МАССИВ ОБЪЕКТОВ, не пусто и не
// содержит null/примитивы (иначе на строке вида null сервер падал бы с
// TypeError вместо аккуратного 400).
const importRowsSchema = z.array(z.record(z.string(), z.any()), { message: 'rows: ожидается массив объектов' })
  .min(1, 'No data')
  .max(5000, 'Слишком много строк за один импорт (максимум 5000). Разбейте файл на части.');

const importHistorySchema = z.object({
  rows: z.preprocess(v => v ?? [], importRowsSchema),
});

const importCsvPreviewSchema = z.object({
  rows: z.preprocess(v => v ?? [], importRowsSchema),
});

const importCsvSchema = z.object({
  rows: z.preprocess(v => v ?? [], importRowsSchema),
  // Без .default() — важно: репозиторий трактует "не передано" как
  // "создавать" (options.create_orgs !== false), а .default(false) в
  // схеме молча ломал это поведение, превращая undefined в явный false.
  create_orgs:      z.coerce.boolean().optional(),
  create_employees: z.coerce.boolean().optional(),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  createAssetSchema,
  updateAssetSchema,
  moveAssetSchema,
  bulkMoveAssetsSchema,
  bulkAssignInvSchema,
  createAccountSchema,
  updateAccountSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  reassignAssetsSchema,
  createOrgSchema,
  updateOrgSchema,
  renameOrgSchema,
  liquidateOrgSchema,
  addInvRuleSchema,
  toggleInvRuleSchema,
  renameInvRuleSchema,
  deleteInvRuleForceSchema,
  createFilialSchema,
  updateFilialSchema,
  closeFilialSchema,
  createLocationSchema,
  updateLocationSchema,
  setCategoriesSchema,
  setTypeCodesSchema,
  reserveInvSchema,
  putStylesSchema,
  putLogoSvgSchema,
  putCompanyNameSchema,
  putPasswordSchema,
  importDiffSchema,
  importApplySchema,
  importHistorySchema,
  importCsvPreviewSchema,
  importCsvSchema,
};
