'use strict';
/**
 * Тесты: VAL-1 (SEC-9) — схемная валидация (zod) на POST/PUT /api/users,
 * эталонный роут для паттерна validate(schema), который дальше
 * распространяется на остальные роуты (VAL-2…VAL-6).
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

describe('POST /api/users — валидация', () => {
  test('без имени → 400 с понятной ошибкой', async () => {
    const res = await request(app).post('/api/users').set(AUTH)
      .send({ login: 'noname', role: 'operator', pin: 'testpin1' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('name');
  });

  test('пустое имя (только пробелы) → 400', async () => {
    const res = await request(app).post('/api/users').set(AUTH)
      .send({ name: '   ', login: 'spacename', role: 'operator', pin: 'testpin1' });
    expect(res.status).toBe(400);
  });

  test('неверная роль → 400', async () => {
    const res = await request(app).post('/api/users').set(AUTH)
      .send({ name: 'Тест Юзер', login: 'badrole', role: 'superadmin', pin: 'testpin1' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('role');
  });

  test('PIN короче 4 символов (но не пустой) → 400', async () => {
    const res = await request(app).post('/api/users').set(AUTH)
      .send({ name: 'Тест Юзер2', login: 'shortpin', role: 'operator', pin: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('pin');
  });

  test('пустой PIN разрешён (фича viewer без пароля, SEC-2) — 200', async () => {
    const res = await request(app).post('/api/users').set(AUTH)
      .send({ name: 'Вьюер Без Пина', login: 'nopinviewer', role: 'viewer', pin: '' });
    expect(res.status).toBe(200);
  });

  test('лишние пробелы в имени обрезаются (.trim())', async () => {
    const res = await request(app).post('/api/users').set(AUTH)
      .send({ name: '  Обрезаемое Имя  ', login: 'trimtest', role: 'operator', pin: 'testpin1' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Обрезаемое Имя');
  });

  test('валидные данные создают пользователя как раньше', async () => {
    const res = await request(app).post('/api/users').set(AUTH)
      .send({ name: 'Корректный Юзер', login: 'validuser', role: 'operator', pin: 'goodpin1' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('operator');
  });
});

describe('PUT /api/users/:id — валидация', () => {
  let userId;
  beforeAll(async () => {
    const r = await request(app).post('/api/users').set(AUTH)
      .send({ name: 'Изменяемый', login: 'editable-val', role: 'operator', pin: 'editpin1' });
    userId = r.body.id;
  });

  test('пустое имя при обновлении → 400', async () => {
    const res = await request(app).put(`/api/users/${userId}`).set(AUTH)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  test('частичное обновление (только role) проходит без остальных полей', async () => {
    const res = await request(app).put(`/api/users/${userId}`).set(AUTH)
      .send({ role: 'viewer' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('viewer');
  });

  test('неверная роль при обновлении → 400', async () => {
    const res = await request(app).put(`/api/users/${userId}`).set(AUTH)
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
  });
});
