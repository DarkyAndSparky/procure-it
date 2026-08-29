'use strict';
/**
 * Тесты: SEC-5 — /api/diag больше не отдаёт пути на диске и данные о бэкапах
 * без авторизации.
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

describe('GET /api/diag', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).get('/api/diag');
    expect(res.status).toBe(401);
  });

  test('оператор (не admin) получает 403', async () => {
    const op = mockDb.createUser({ name: 'Diag Op', login: 'diagop', role: 'operator', pin: 'diagpin1' });
    const res = await request(app).get('/api/diag')
      .set({ 'x-user-id': op.id, 'x-edit-password': 'diagpin1' });
    expect(res.status).toBe(403);
  });

  test('viewer получает 403', async () => {
    const viewer = mockDb.createUser({ name: 'Diag Viewer', login: 'diagviewer', role: 'viewer', pin: '' });
    const res = await request(app).get('/api/diag')
      .set({ 'x-user-id': viewer.id, 'x-edit-password': '' });
    expect(res.status).toBe(403);
  });

  test('admin получает диагностику', async () => {
    const res = await request(app).get('/api/diag').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dbPath');
    expect(res.body).toHaveProperty('schema_version');
  });
});
