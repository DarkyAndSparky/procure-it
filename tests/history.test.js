'use strict';
/**
 * Тесты: история — фильтры, создание записей через действия
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

async function createAsset(fields = {}) {
  const res = await request(app).post('/api/assets').set(AUTH)
    .send({ model: 'Test NB', type: 'Ноутбук', tab: 'os',
            responsible: 'Тестов', status: 'используется', ...fields });
  return res.body.id;
}

describe('GET /api/history', () => {
  let asset1, asset2;

  beforeAll(async () => {
    asset1 = await createAsset({ model: 'HistNB-1', responsible: 'Иванов', filial: 'Москва' });
    asset2 = await createAsset({ model: 'HistNB-2', responsible: 'Петров', filial: 'Питер' });
    // Перемещение
    await request(app).post(`/api/assets/${asset1}/move`).set(AUTH)
      .send({ newResponsible: 'Сидоров', reason: 'Тест перемещения' });
    // Списание
    await request(app).delete(`/api/assets/${asset2}`).set(AUTH);
  });

  test('возвращает объект с items, total, stats', async () => {
    const res = await request(app).get('/api/history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.stats).toHaveProperty('total');
    expect(res.body.stats).toHaveProperty('adds');
    expect(res.body.stats).toHaveProperty('moves');
    expect(res.body.stats).toHaveProperty('retires');
  });

  test('фильтр по asset_id', async () => {
    const res = await request(app).get(`/api/history?asset_id=${asset1}`);
    expect(res.status).toBe(200);
    expect(res.body.items.every(h => h.asset_id === asset1)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2); // add + move
  });

  test('фильтр по action_type=add', async () => {
    const res = await request(app).get('/api/history?action_type=add');
    expect(res.body.items.every(h => h.action_type === 'add')).toBe(true);
  });

  test('фильтр по action_type=move', async () => {
    const res = await request(app).get('/api/history?action_type=move');
    expect(res.body.items.every(h => h.action_type === 'move')).toBe(true);
    expect(res.body.items.some(h => h.asset_id === asset1)).toBe(true);
  });

  test('фильтр по action_type=retire', async () => {
    const res = await request(app).get('/api/history?action_type=retire');
    expect(res.body.items.every(h => h.action_type === 'retire')).toBe(true);
    expect(res.body.items.some(h => h.asset_id === asset2)).toBe(true);
  });

  test('фильтр по filial', async () => {
    const res = await request(app).get('/api/history?filial=Москва');
    expect(res.body.items.every(h => h.filial === 'Москва')).toBe(true);
  });

  test('поиск по search (по ответственному)', async () => {
    const res = await request(app).get('/api/history?search=Сидоров');
    expect(res.body.items.some(h =>
      (h.to_who||'').toLowerCase().includes('сидоров')
    )).toBe(true);
  });

  test('поиск по search (по модели в equipment)', async () => {
    const res = await request(app).get('/api/history?search=HistNB-1');
    expect(res.body.items.some(h =>
      (h.equipment||'').includes('HistNB-1')
    )).toBe(true);
  });

  test('фильтр по from_date / to_date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/history?from_date=${today}&to_date=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every(h => h.date.slice(0,10) === today)).toBe(true);
  });

  test('лимит по умолчанию не превышает 500', async () => {
    const res = await request(app).get('/api/history');
    expect(res.body.items.length).toBeLessThanOrEqual(500);
  });

  test('SEC-8: явно запрошенный ?limit=999999 всё равно капается потолком, не отдаёт всё разом', async () => {
    const res = await request(app).get('/api/history?limit=999999');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(500);
  });

  test('stats.adds считает добавления', async () => {
    const res = await request(app).get('/api/history');
    expect(res.body.stats.adds).toBeGreaterThanOrEqual(2);
  });

  test('stats.retires считает списания', async () => {
    const res = await request(app).get('/api/history');
    expect(res.body.stats.retires).toBeGreaterThanOrEqual(1);
  });
});

describe('История — корректность записей', () => {
  test('каждая запись содержит обязательные поля', async () => {
    const res = await request(app).get('/api/history');
    const bad = res.body.items.filter(h => !h.id || !h.action_type || !h.date);
    expect(bad).toEqual([]);
  });

  test('записи возвращаются в обратном хронологическом порядке', async () => {
    const res = await request(app).get('/api/history');
    const dates = res.body.items.map(h => h.date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1] >= dates[i]).toBe(true);
    }
  });
});
