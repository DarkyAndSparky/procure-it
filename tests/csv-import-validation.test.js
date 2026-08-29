'use strict';
/**
 * Тесты: VAL-6 (SEC-9) — схемная валидация (zod) на роутах CSV-импорта.
 * Лимит в 5000 строк уже покрыт тестами SEC-8 — здесь фокус на ФОРМЕ
 * содержимого rows[] (не только на количестве).
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

describe('POST /api/import/csv/preview — валидация формы rows', () => {
  test('rows содержит null-элемент → 400, не 500 (раньше могло упасть TypeError)', async () => {
    const res = await request(app).post('/api/import/csv/preview').set(AUTH)
      .send({ rows: [{ model: 'X', org: 'Y' }, null] });
    expect(res.status).toBe(400);
  });

  test('rows — строка, а не массив → 400', async () => {
    const res = await request(app).post('/api/import/csv/preview').set(AUTH)
      .send({ rows: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  test('rows — массив строк вместо объектов → 400', async () => {
    const res = await request(app).post('/api/import/csv/preview').set(AUTH)
      .send({ rows: ['just', 'strings'] });
    expect(res.status).toBe(400);
  });

  test('пустой массив rows → 400 (No data)', async () => {
    const res = await request(app).post('/api/import/csv/preview').set(AUTH).send({ rows: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/import/history — валидация формы rows', () => {
  test('без rows вообще → 400, не 500', async () => {
    const res = await request(app).post('/api/import/history').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('rows с null-элементом → 400', async () => {
    const res = await request(app).post('/api/import/history').set(AUTH)
      .send({ rows: [null] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/import/csv — create_orgs/create_employees не сломаны схемой', () => {
  test('create_orgs не передан → организация всё равно создаётся (дефолт репозитория, не схемы)', async () => {
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'VAL6-Test', type: 'Ноутбук', org: 'VAL6-НоваяОрг', serial: 'VAL6-SN-1' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    expect(res.body.created_orgs).toContain('val6-новаяорг');
  });

  test('create_orgs: false (реальный boolean из JSON) — организация НЕ создаётся', async () => {
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'VAL6-NoOrg', type: 'Ноутбук', org: 'VAL6-НеДолжнаСоздаться', serial: 'VAL6-SN-2' }],
      create_orgs: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    const orgs = mockDb.config.getOrgs(true);
    expect(orgs.some(o => o.name === 'VAL6-НеДолжнаСоздаться')).toBe(false);
  });
});
