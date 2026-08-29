'use strict';
/**
 * Тесты: VAL-3 (SEC-9) — схемная валидация (zod) на роутах учётных
 * записей (accounts) и сотрудников (employees), включая reassign-assets.
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

describe('POST /api/accounts — валидация', () => {
  test('без name → 400', async () => {
    const res = await request(app).post('/api/accounts').set(AUTH).send({ login: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('name');
  });

  test('пустое name (пробелы) → 400', async () => {
    const res = await request(app).post('/api/accounts').set(AUTH).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  test('слишком длинный пароль (>500 символов) → 400', async () => {
    const res = await request(app).post('/api/accounts').set(AUTH)
      .send({ name: 'Роутер', password: 'a'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('password');
  });

  test('валидные данные создают учётку как раньше', async () => {
    const res = await request(app).post('/api/accounts').set(AUTH)
      .send({ name: 'Свитч 3F', login: 'admin', password: 'secret123', category: 'network' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.ok).toBe(true);
  });
});

describe('PUT /api/accounts/:id — валидация', () => {
  let accId;
  beforeAll(async () => {
    const r = await request(app).post('/api/accounts').set(AUTH).send({ name: 'ToEdit' });
    accId = r.body.id;
  });

  test('пустое name при обновлении → 400', async () => {
    const res = await request(app).put(`/api/accounts/${accId}`).set(AUTH).send({ name: '' });
    expect(res.status).toBe(400);
  });

  test('частичное обновление (только note) проходит', async () => {
    const res = await request(app).put(`/api/accounts/${accId}`).set(AUTH).send({ note: 'заметка' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/employees — валидация', () => {
  test('пустое имя (пробелы) → 400', async () => {
    const res = await request(app).post('/api/employees').set(AUTH).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  test('слишком длинный телефон (>50 символов) → 400', async () => {
    const res = await request(app).post('/api/employees').set(AUTH)
      .send({ name: 'Петров Пётр', phone: '9'.repeat(51) });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('phone');
  });

  test('лишние пробелы в ФИО обрезаются', async () => {
    const res = await request(app).post('/api/employees').set(AUTH)
      .send({ name: '  Сидоров Сидор  ' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Сидоров Сидор');
  });
});

describe('PUT /api/employees/:id — валидация', () => {
  let empId;
  beforeAll(async () => {
    const r = await request(app).post('/api/employees').set(AUTH).send({ name: 'Изменяемый Сотрудник' });
    empId = r.body.id;
  });

  test('пустое ФИО при обновлении → 400', async () => {
    const res = await request(app).put(`/api/employees/${empId}`).set(AUTH).send({ name: '' });
    expect(res.status).toBe(400);
  });

  test('active принимает boolean как раньше', async () => {
    const res = await request(app).put(`/api/employees/${empId}`).set(AUTH).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });
});

describe('POST /api/employees/:id/reassign-assets — валидация', () => {
  let empId;
  beforeAll(async () => {
    const r = await request(app).post('/api/employees').set(AUTH).send({ name: 'Реассайн Тест' });
    empId = r.body.id;
  });

  test('слишком длинный to_employee_id (>100 символов) → 400', async () => {
    const res = await request(app).post(`/api/employees/${empId}/reassign-assets`).set(AUTH)
      .send({ to_employee_id: 'x'.repeat(101) });
    expect(res.status).toBe(400);
  });

  test('пустое тело (без to_employee_id) — валидно, активы остаются без ответственного', async () => {
    const res = await request(app).post(`/api/employees/${empId}/reassign-assets`).set(AUTH).send({});
    expect(res.status).toBe(200);
  });
});
