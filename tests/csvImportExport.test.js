'use strict';
/**
 * Тесты: csv.repo.js — exportCsv / previewCsvImport / importCsv
 * (POST /api/import/csv, /api/import/csv/preview, GET /api/export/csv)
 *
 * До этого набора тестов ни один из трёх эндпоинтов не имел покрытия
 * вообще (см. историю Фазы 7c) — самая рискованная и наименее защищённая
 * тестами область проекта.
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
const org    = mockDb.config.createOrg({ name: 'Ярко', short_code: 'YRK', inv_rules: [
  { type_code: 'NB', type_name: 'Ноутбук' },
]});

jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

// ─── GET /api/export/csv ────────────────────────────────────────────────────
describe('GET /api/export/csv', () => {
  test('SEC-8: без авторизации → 401 (раньше был не защищён, это дыра)', async () => {
    const res = await request(app).get('/api/export/csv');
    expect(res.status).toBe(401);
  });

  test('возвращает CSV с BOM и корректными заголовками колонок', async () => {
    const res = await request(app).get('/api/export/csv').set(AUTH);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.charCodeAt(0)).toBe(0xFEFF); // BOM
    expect(res.text).toContain('"Инв. номер";"Вкладка";"Коллекция"');
  });

  test('включает созданный актив, не включает списанный', async () => {
    const created = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'Dell CSV-Export-Test', type: 'Ноутбук', tab: 'os' });
    const retired = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'HP CSV-Retired-Test', type: 'Ноутбук', tab: 'os' });
    await request(app).delete(`/api/assets/${retired.body.id}`).set(AUTH);

    const res = await request(app).get('/api/export/csv').set(AUTH);
    expect(res.text).toContain('Dell CSV-Export-Test');
    expect(res.text).not.toContain('HP CSV-Retired-Test');
  });

  test('?tab= фильтрует по вкладке', async () => {
    const res = await request(app).get('/api/export/csv?tab=small').set(AUTH);
    // модели из tab=os не должны попасть в выгрузку по tab=small
    expect(res.text).not.toContain('Dell CSV-Export-Test');
  });
});

// ─── POST /api/import/csv/preview ──────────────────────────────────────────
describe('POST /api/import/csv/preview', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/import/csv/preview').send({ rows: [{}] });
    expect(res.status).toBe(401);
  });

  test('без rows → 400', async () => {
    const res = await request(app).post('/api/import/csv/preview').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('SEC-8: больше 5000 строк за раз → 400, не пытается обработать', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ model: `X${i}` }));
    const res = await request(app).post('/api/import/csv/preview').set(AUTH).send({ rows });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5000|максимум/i);
  });

  test('находит организации, которых ещё нет в системе', async () => {
    const res = await request(app).post('/api/import/csv/preview').set(AUTH).send({
      rows: [
        { model: 'A', type: 'Ноутбук', org: 'Совершенно Новая Орг' },
        { model: 'B', type: 'Ноутбук', org: 'Совершенно Новая Орг' },
        { model: 'C', type: 'Ноутбук', org: 'Ярко' }, // уже существует
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.total_rows).toBe(3);
    const unknown = res.body.unknown_orgs.find(o => o.name === 'Совершенно Новая Орг');
    expect(unknown).toBeTruthy();
    expect(unknown.count).toBe(2);
    expect(res.body.unknown_orgs.find(o => o.name === 'Ярко')).toBeUndefined();
  });
});

// ─── POST /api/import/csv ───────────────────────────────────────────────────
describe('POST /api/import/csv', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/import/csv').send({ rows: [{}] });
    expect(res.status).toBe(401);
  });

  test('без модели — строка пропускается (skipReasons.no_model)', async () => {
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ type: 'Ноутбук' }], // нет model
    });
    expect(res.body.added).toBe(0);
    expect(res.body.skipReasons.no_model).toBe(1);
  });

  test('создаёт актив с новыми филиалом/локацией/организацией/сотрудником', async () => {
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{
        model: 'Lenovo ImportTest-1', type: 'Ноутбук', tab: 'os',
        filial: 'Импорт-Филиал', location: 'Импорт-Каб', org: 'Импорт-Орг',
        responsible: 'Импорт Тестов Иванович', serial: 'IMPORT-SN-001',
      }],
    });
    expect(res.body.added).toBe(1);
    expect(res.body.created_orgs).toContain('импорт-орг');

    const filials = mockDb.config.getFilials(true);
    expect(filials.some(f => f.name === 'Импорт-Филиал')).toBe(true);
    const emps = mockDb.getEmployees(false);
    expect(emps.some(e => e.name === 'Импорт Тестов Иванович')).toBe(true);
  });

  test('дедупликация по серийному номеру — повторный импорт того же serial пропускается', async () => {
    const rows = [{ model: 'Dedupe Model', type: 'Ноутбук', serial: 'DEDUPE-SN-777' }];
    const first = await request(app).post('/api/import/csv').set(AUTH).send({ rows });
    expect(first.body.added).toBe(1);

    const second = await request(app).post('/api/import/csv').set(AUTH).send({ rows });
    expect(second.body.added).toBe(0);
    expect(second.body.skipReasons.dupe_serial).toBe(1);
  });

  test('дедупликация по ключу (модель+филиал+локация+ответственный) когда нет serial', async () => {
    const rows = [{
      model: 'NoSerial Model', type: 'Ноутбук',
      filial: 'ДедупФилиал', location: 'ДедупЛок', responsible: 'Дедуп Тестов',
    }];
    const first = await request(app).post('/api/import/csv').set(AUTH).send({ rows });
    expect(first.body.added).toBe(1);

    const second = await request(app).post('/api/import/csv').set(AUTH).send({ rows });
    expect(second.body.added).toBe(0);
    expect(second.body.skipReasons.dupe_key).toBe(1);
  });

  test('create_orgs=false — неизвестная организация не создаётся, актив уходит в sys-org-unk', async () => {
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'NoOrgCreate', type: 'Ноутбук', org: 'Не Должна Появиться', serial: 'NOORG-SN' }],
      create_orgs: false,
    });
    expect(res.body.added).toBe(1);
    const orgs = mockDb.config.getOrgs(true);
    expect(orgs.some(o => o.name === 'Не Должна Появиться')).toBe(false);
  });

  test('create_employees=false — сотрудник не создаётся, ответственный уходит пустым', async () => {
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'NoEmpCreate', type: 'Ноутбук', responsible: 'Не Должен Появиться', serial: 'NOEMP-SN' }],
      create_employees: false,
    });
    expect(res.body.added).toBe(1);
    const emps = mockDb.getEmployees(false);
    expect(emps.some(e => e.name === 'Не Должен Появиться')).toBe(false);
  });

  test('meta-поля (ip/mac/hostname и т.д.) сохраняются и видны через GET', async () => {
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'MetaTest', type: 'Ноутбук', serial: 'META-SN-1',
        ip: '10.1.1.1', mac: 'AA:BB:CC:DD:EE:FF', hostname: 'META-HOST' }],
    });
    expect(res.body.added).toBe(1);
    const list = await request(app).get('/api/assets?search=MetaTest').set(AUTH);
    const found = list.body.items.find(a => a.model === 'MetaTest');
    expect(found.meta.ip).toBe('10.1.1.1');
    expect(found.meta.hostname).toBe('META-HOST');
  });

  test('без serial и с настроенным inv_rule у организации — авто-присваивает инв. номер', async () => {
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'AutoInvTest', type: 'Ноутбук', org: 'Ярко' }], // без serial
    });
    expect(res.body.added).toBe(1);
    expect(res.body.inv_assigned).toBeGreaterThanOrEqual(1);
    const list = await request(app).get('/api/assets?search=AutoInvTest').set(AUTH);
    const found = list.body.items.find(a => a.model === 'AutoInvTest');
    expect(found.inv).toMatch(/^YRK-NB-\d{5}$/);
  });
});
