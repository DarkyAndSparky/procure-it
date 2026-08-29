'use strict';
/**
 * Тесты: VAL-5 (SEC-9) — схемная валидация (zod) на роутах настроек
 * (styles/logo_svg/company_name/password) и импорта конфига.
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

describe('PUT /api/settings/styles — валидация', () => {
  test('styles не объект (строка) → 400', async () => {
    const res = await request(app).put('/api/settings/styles').set(AUTH).send({ styles: 'not-an-object' });
    expect(res.status).toBe(400);
  });

  test('styles массив → 400 (раньше проходило из-за typeof)', async () => {
    const res = await request(app).put('/api/settings/styles').set(AUTH).send({ styles: [1,2,3] });
    expect(res.status).toBe(400);
  });

  test('валидный объект styles проходит', async () => {
    const res = await request(app).put('/api/settings/styles').set(AUTH).send({ styles: { primary: '#000' } });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/settings/logo_svg — валидация', () => {
  test('неверный формат (не svg, не data URL) → 400', async () => {
    const res = await request(app).put('/api/settings/logo_svg').set(AUTH).send({ svg: 'random garbage text' });
    expect(res.status).toBe(400);
  });

  test('слишком большой логотип (>512KB) → 400', async () => {
    const res = await request(app).put('/api/settings/logo_svg').set(AUTH)
      .send({ svg: '<svg>' + 'a'.repeat(512 * 1024) + '</svg>' });
    expect(res.status).toBe(400);
  });

  test('валидный <svg> проходит', async () => {
    const res = await request(app).put('/api/settings/logo_svg').set(AUTH)
      .send({ svg: '<svg viewBox="0 0 10 10"></svg>' });
    expect(res.status).toBe(200);
  });

  test('пустая строка (сброс логотипа) — валидна', async () => {
    const res = await request(app).put('/api/settings/logo_svg').set(AUTH).send({ svg: '' });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/settings/company_name — валидация', () => {
  test('пустое название → 400', async () => {
    const res = await request(app).put('/api/settings/company_name').set(AUTH).send({ company_name: '   ' });
    expect(res.status).toBe(400);
  });

  test('без company_name вообще → 400', async () => {
    const res = await request(app).put('/api/settings/company_name').set(AUTH).send({});
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/settings/password — валидация', () => {
  const AUTH2 = () => AUTH;
  afterEach(async () => {
    // возвращаем пароль обратно, если тест успел его сменить
    await request(app).put('/api/settings/password')
      .set({ 'x-user-id': AUTH['x-user-id'], 'x-edit-password': 'shortpw' })
      .send({ newPassword: 'test123' })
      .catch(() => {});
  });

  test('пароль короче 4 символов → 400', async () => {
    const res = await request(app).put('/api/settings/password').set(AUTH).send({ newPassword: 'abc' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/config/import/diff — валидация', () => {
  test('без config → 400', async () => {
    const res = await request(app).post('/api/config/import/diff').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('config без organizations/filials/locations → 400 с перечислением', async () => {
    const res = await request(app).post('/api/config/import/diff').set(AUTH).send({ config: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/organizations/);
  });
});

describe('POST /api/config/import/apply — валидация', () => {
  test('без clean/incoming → 400', async () => {
    const res = await request(app).post('/api/config/import/apply').set(AUTH).send({ resolutions: [] });
    expect(res.status).toBe(400);
  });
});
