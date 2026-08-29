'use strict';
/**
 * Тесты: VAL-4 (SEC-9) — схемная валидация (zod) на роутах оргструктуры:
 * организации, филиалы, локации, категории, коды типов, инв. номера.
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

describe('POST /api/orgs — валидация', () => {
  test('без name/short_code → 400', async () => {
    const res = await request(app).post('/api/orgs').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('слишком длинный short_code (>20 символов) → 400', async () => {
    const res = await request(app).post('/api/orgs').set(AUTH)
      .send({ name: 'Длинный Код Орг', short_code: 'X'.repeat(21) });
    expect(res.status).toBe(400);
  });

  test('inv_rules с пустым type_code → 400', async () => {
    const res = await request(app).post('/api/orgs').set(AUTH)
      .send({ name: 'ИнвПравило', short_code: 'IVR', inv_rules: [{ type_code: '', type_name: 'X' }] });
    expect(res.status).toBe(400);
  });

  test('валидные данные создают организацию как раньше', async () => {
    const res = await request(app).post('/api/orgs').set(AUTH)
      .send({ name: 'ВАЛ4 Орг', short_code: 'V4O' });
    expect(res.status).toBe(200);
    expect(res.body.short_code).toBe('V4O');
  });
});

describe('POST /api/orgs/:id/rename — валидация', () => {
  let orgId;
  beforeAll(async () => {
    const r = await request(app).post('/api/orgs').set(AUTH).send({ name: 'ToRename', short_code: 'TRN' });
    orgId = r.body.id;
  });

  test('без newName → 400', async () => {
    const res = await request(app).post(`/api/orgs/${orgId}/rename`).set(AUTH).send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/orgs/:id/liquidate — валидация', () => {
  let orgId, targetId;
  beforeAll(async () => {
    const r1 = await request(app).post('/api/orgs').set(AUTH).send({ name: 'ToLiquidate', short_code: 'TLQ' });
    orgId = r1.body.id;
    const r2 = await request(app).post('/api/orgs').set(AUTH).send({ name: 'LiqTarget', short_code: 'LQT' });
    targetId = r2.body.id;
  });

  test('без targetOrgId → 400', async () => {
    const res = await request(app).post(`/api/orgs/${orgId}/liquidate`).set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('с targetOrgId — проходит как раньше', async () => {
    const res = await request(app).post(`/api/orgs/${orgId}/liquidate`).set(AUTH).send({ targetOrgId: targetId });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/orgs/:id/inv-rules — валидация', () => {
  let orgId;
  beforeAll(async () => {
    const r = await request(app).post('/api/orgs').set(AUTH).send({ name: 'InvRuleOrg', short_code: 'IRO' });
    orgId = r.body.id;
  });

  test('без type_code → 400', async () => {
    const res = await request(app).post(`/api/orgs/${orgId}/inv-rules`).set(AUTH).send({ type_name: 'X' });
    expect(res.status).toBe(400);
  });

  test('валидное правило создаётся', async () => {
    const res = await request(app).post(`/api/orgs/${orgId}/inv-rules`).set(AUTH)
      .send({ type_code: 'nb', type_name: 'Ноутбук' });
    expect(res.status).toBe(200);
    expect(res.body.type_code).toBe('NB');
  });
});

describe('POST /api/orgs/:id/inv-rules/:code/delete-force — валидация', () => {
  test('неверный action → 400', async () => {
    const org = await request(app).post('/api/orgs').set(AUTH).send({ name: 'DelForceOrg', short_code: 'DFO' });
    await request(app).post(`/api/orgs/${org.body.id}/inv-rules`).set(AUTH).send({ type_code: 'PR', type_name: 'X' });
    const res = await request(app).post(`/api/orgs/${org.body.id}/inv-rules/PR/delete-force`).set(AUTH)
      .send({ action: 'nuke' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/filials — валидация', () => {
  test('без name → 400', async () => {
    const res = await request(app).post('/api/filials').set(AUTH).send({ address: 'ул. Тест' });
    expect(res.status).toBe(400);
  });

  test('слишком длинный адрес (>300 символов) → 400', async () => {
    const res = await request(app).post('/api/filials').set(AUTH)
      .send({ name: 'ДлинныйАдрес', address: 'a'.repeat(301) });
    expect(res.status).toBe(400);
  });

  test('валидные данные создают филиал как раньше', async () => {
    const res = await request(app).post('/api/filials').set(AUTH).send({ name: 'ВАЛ4 Филиал' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/locations — валидация', () => {
  let filialId;
  beforeAll(async () => {
    const r = await request(app).post('/api/filials').set(AUTH).send({ name: 'LocFilial' });
    filialId = r.body.id;
  });

  test('без name/filial_id → 400', async () => {
    const res = await request(app).post('/api/locations').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('дефолтный type=office подставляется как раньше', async () => {
    const res = await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'ВАЛ4 Локация', filial_id: filialId });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('office');
  });
});

describe('PUT /api/categories/:tab — валидация', () => {
  test('categories не массив → 400', async () => {
    const res = await request(app).put('/api/categories/os').set(AUTH).send({ categories: 'not-array' });
    expect(res.status).toBe(400);
  });

  test('валидный массив категорий проходит', async () => {
    const res = await request(app).put('/api/categories/os').set(AUTH).send({ categories: ['Ноутбуки', 'ПК'] });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/type-codes — валидация', () => {
  test('codes не массив → 400', async () => {
    const res = await request(app).put('/api/type-codes').set(AUTH).send({ codes: 'nope' });
    expect(res.status).toBe(400);
  });

  test('неверный tab внутри элемента → 400', async () => {
    const res = await request(app).put('/api/type-codes').set(AUTH)
      .send({ codes: [{ code: 'NB', name: 'Ноутбук', tab: 'not-a-tab' }] });
    expect(res.status).toBe(400);
  });

  test('валидный набор кодов проходит', async () => {
    const res = await request(app).put('/api/type-codes').set(AUTH)
      .send({ codes: [{ code: 'NB', name: 'Ноутбук', tab: 'os' }] });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/inv/reserve — валидация', () => {
  test('без type → 400', async () => {
    const res = await request(app).post('/api/inv/reserve').set(AUTH).send({ org: 'VLT' });
    expect(res.status).toBe(400);
  });
});
