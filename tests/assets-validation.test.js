'use strict';
/**
 * Тесты: VAL-2 (SEC-9) — схемная валидация (zod) на роутах активов:
 * create/update/move/bulk-move/bulk-assign-inv.
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
const org = mockDb.config.createOrg({ name: 'ValTest', short_code: 'VLT' });
mockDb.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });

jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

describe('POST /api/assets — валидация', () => {
  test('неверный tab → 400', async () => {
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'X', tab: 'not-a-real-tab' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('tab');
  });

  test('неверный status → 400', async () => {
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'X', tab: 'os', status: 'сгорел' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('status');
  });

  test('слишком длинное примечание (>2000 символов) → 400', async () => {
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'X', tab: 'os', note: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('note');
  });

  test('лишние пробелы в model обрезаются', async () => {
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ model: '  Lenovo T14  ', tab: 'os' });
    expect(res.status).toBe(200);
  });

  test('валидные данные с дефолтными tab/status создают ассет как раньше', async () => {
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'Default Fields Test' });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/assets/:id — валидация', () => {
  let assetId;
  beforeAll(async () => {
    const r = await request(app).post('/api/assets').set(AUTH).send({ model: 'ToUpdate', tab: 'os' });
    assetId = r.body.id;
  });

  test('неверный tab при обновлении → 400', async () => {
    const res = await request(app).put(`/api/assets/${assetId}`).set(AUTH).send({ tab: 'xyz' });
    expect(res.status).toBe(400);
  });

  test('пустой model при обновлении → 400', async () => {
    const res = await request(app).put(`/api/assets/${assetId}`).set(AUTH).send({ model: '' });
    expect(res.status).toBe(400);
  });

  test('частичное обновление (только note) проходит', async () => {
    const res = await request(app).put(`/api/assets/${assetId}`).set(AUTH).send({ note: 'ok' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/assets/:id/move — валидация', () => {
  let assetId;
  beforeAll(async () => {
    const r = await request(app).post('/api/assets').set(AUTH).send({ model: 'ToMove', tab: 'os' });
    assetId = r.body.id;
  });

  test('слишком длинная причина (>500 символов) → 400', async () => {
    const res = await request(app).post(`/api/assets/${assetId}/move`).set(AUTH)
      .send({ reason: 'a'.repeat(501) });
    expect(res.status).toBe(400);
  });

  test('пустое тело — валидно (все поля опциональны)', async () => {
    const res = await request(app).post(`/api/assets/${assetId}/move`).set(AUTH).send({});
    expect(res.status).toBe(200);
  });
});

describe('POST /api/assets/bulk-move — валидация', () => {
  test('без ids → 400', async () => {
    const res = await request(app).post('/api/assets/bulk-move').set(AUTH).send({ reason: 'test' });
    expect(res.status).toBe(400);
  });

  test('пустой массив ids → 400', async () => {
    const res = await request(app).post('/api/assets/bulk-move').set(AUTH).send({ ids: [] });
    expect(res.status).toBe(400);
  });

  test('больше 1000 id за раз → 400', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
    const res = await request(app).post('/api/assets/bulk-move').set(AUTH).send({ ids });
    expect(res.status).toBe(400);
  });

  test('валидный массив ids проходит (даже если id не существуют — это уже бизнес-логика, не 400)', async () => {
    const res = await request(app).post('/api/assets/bulk-move').set(AUTH).send({ ids: ['nonexistent-id'] });
    expect(res.status).toBe(200);
    expect(res.body.failed).toContain('nonexistent-id');
  });
});

describe('POST /api/assets/bulk-assign-inv — валидация', () => {
  test('без org_id/type_code → 400', async () => {
    const res = await request(app).post('/api/assets/bulk-assign-inv').set(AUTH).send({ ids: ['x'] });
    expect(res.status).toBe(400);
  });

  test('без ids → 400', async () => {
    const res = await request(app).post('/api/assets/bulk-assign-inv').set(AUTH)
      .send({ org_id: org.id, type_code: 'NB' });
    expect(res.status).toBe(400);
  });

  test('валидные данные проходят валидацию', async () => {
    const created = await request(app).post('/api/assets').set(AUTH).send({ model: 'InvAssign', tab: 'os' });
    const res = await request(app).post('/api/assets/bulk-assign-inv').set(AUTH)
      .send({ ids: [created.body.id], org_id: org.id, type_code: 'NB' });
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(1);
  });
});
