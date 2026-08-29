'use strict';
/**
 * Тесты: HTTP эндпоинты (REST API) через supertest
 *
 * Используем реальный express app, но с мокнутым database.js —
 * чтобы не читать реальные файлы данных.
 */
const request = require('supertest');

// ── Мокаем database.js до require app ────────────────────────────────────────
const makeDb = require('./helpers/makeDb');
const mockDb = makeDb();

// Добавляем тестовые данные
const testOrg = mockDb.config.createOrg({ name: 'Тест Орг', short_code: 'TST' });
mockDb.config.addInvRule(testOrg.id, { type_code: 'NB', type_name: 'Ноутбук' });
mockDb.config.createFilial({ name: 'Главный', address: 'ул. Тест, 1', org_id: testOrg.id });

jest.mock('../server/database', () => mockDb);

const app = require('../server/index');

// ── Хелпер: auth header ───────────────────────────────────────────────────────
// Получаем auth-заголовки через /api/users/login
let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
  if (res.body?.user?.id) {
    AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/health', () => {
  test('200 OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /api/users/login', () => {
  test('верный логин/пароль → ok:true + user', async () => {
    const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe('admin');
  });

  test('неверный пароль → 401', async () => {
    const res = await request(app).post('/api/users/login').send({ login:'admin', password:'wrong' });
    expect(res.status).toBe(401);
  });

  test('несуществующий логин → 401', async () => {
    const res = await request(app).post('/api/users/login').send({ login:'nobody', password:'x' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/settings', () => {
  test('возвращает company_name', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.company_name).toBe('Test Company');
  });
});

// ── Организации ───────────────────────────────────────────────────────────────
describe('GET /api/orgs', () => {
  test('возвращает список организаций без системных', async () => {
    const res = await request(app).get('/api/orgs').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every(o => !o.system)).toBe(true);
    expect(res.body.some(o => o.name === 'Тест Орг')).toBe(true);
  });
});

describe('POST /api/orgs (requireAuth)', () => {
  test('без заголовка → 401', async () => {
    const res = await request(app).post('/api/orgs').send({ name: 'Новая', short_code: 'NEW' });
    expect(res.status).toBe(401);
  });

  test('с заголовком → 200, создаёт org', async () => {
    const res = await request(app)
      .post('/api/orgs')
      .set(AUTH)
      .send({ name: 'Новая Орг', short_code: 'NEW' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Новая Орг');
    expect(res.body.short_code).toBe('NEW');
  });

  test('дублирующий код → 400', async () => {
    const res = await request(app)
      .post('/api/orgs')
      .set(AUTH)
      .send({ name: 'Дубль', short_code: 'TST' }); // TST уже есть
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Дублирует/);
  });
});

describe('POST /api/orgs/:id/inv-rules', () => {
  test('добавляет правило', async () => {
    const res = await request(app)
      .post(`/api/orgs/${testOrg.id}/inv-rules`)
      .set(AUTH)
      .send({ type_code: 'MON', type_name: 'Монитор' });
    expect(res.status).toBe(200);
    expect(res.body.type_code).toBe('MON');
  });

  test('дублирующий код → 400', async () => {
    const res = await request(app)
      .post(`/api/orgs/${testOrg.id}/inv-rules`)
      .set(AUTH)
      .send({ type_code: 'NB', type_name: 'Дубль' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/orgs/:id/inv-rules/:typeCode (toggle)', () => {
  test('отключает правило', async () => {
    const res = await request(app)
      .patch(`/api/orgs/${testOrg.id}/inv-rules/NB`)
      .set(AUTH)
      .send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Включаем обратно
    await request(app)
      .patch(`/api/orgs/${testOrg.id}/inv-rules/NB`)
      .set(AUTH)
      .send({ active: true });
  });
});

describe('PUT /api/orgs/:id/inv-rules/:typeCode (rename)', () => {
  test('переименовывает правило', async () => {
    const res = await request(app)
      .put(`/api/orgs/${testOrg.id}/inv-rules/NB`)
      .set(AUTH)
      .send({ type_name: 'Лэптоп' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('пустое имя → 400', async () => {
    const res = await request(app)
      .put(`/api/orgs/${testOrg.id}/inv-rules/NB`)
      .set(AUTH)
      .send({ type_name: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/orgs/:id/inv-rules/:typeCode', () => {
  test('удаляет правило без ассетов', async () => {
    // Создаём отдельную org и правило чтобы не мешать другим тестам
    const org2 = mockDb.config.createOrg({ name: 'Орг для удаления', short_code: 'DEL' });
    mockDb.config.addInvRule(org2.id, { type_code: 'TV', type_name: 'Телевизор' });
    const res = await request(app)
      .delete(`/api/orgs/${org2.id}/inv-rules/TV`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('с ассетами → возвращает conflict', async () => {
    const org3 = mockDb.config.createOrg({ name: 'Орг с ассетами', short_code: 'OWA' });
    mockDb.config.addInvRule(org3.id, { type_code: 'PC', type_name: 'ПК' });
    mockDb._addAsset({ inv: 'OWA-PC-00001', org_id: org3.id });
    const res = await request(app)
      .delete(`/api/orgs/${org3.id}/inv-rules/PC`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.conflict).toBe(true);
    expect(res.body.count).toBe(1);
  });
});

describe('POST /api/orgs/:id/inv-rules/:typeCode/delete-force', () => {
  test('action=reset обнуляет инв. номера', async () => {
    const org4 = mockDb.config.createOrg({ name: 'Орг Force', short_code: 'FRC' });
    mockDb.config.addInvRule(org4.id, { type_code: 'UPS', type_name: 'ИБП' });
    mockDb._addAsset({ inv: 'FRC-UPS-00001', org_id: org4.id });
    const res = await request(app)
      .post(`/api/orgs/${org4.id}/inv-rules/UPS/delete-force`)
      .set(AUTH)
      .send({ action: 'reset' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('без action → 400', async () => {
    const res = await request(app)
      .post(`/api/orgs/${testOrg.id}/inv-rules/NB/delete-force`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── Филиалы ───────────────────────────────────────────────────────────────────
describe('GET /api/filials', () => {
  test('возвращает список филиалов', async () => {
    const res = await request(app).get('/api/filials').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(f => f.name === 'Главный')).toBe(true);
  });
});

describe('POST /api/filials', () => {
  test('создаёт филиал', async () => {
    const res = await request(app)
      .post('/api/filials')
      .set(AUTH)
      .send({ name: 'Новый филиал', address: 'ул. Новая, 10' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Новый филиал');
  });

  test('без name → 400', async () => {
    const res = await request(app)
      .post('/api/filials')
      .set(AUTH)
      .send({ address: 'Адрес без имени' });
    expect(res.status).toBe(400);
  });
});

// ── Ассеты ────────────────────────────────────────────────────────────────────
describe('GET /api/assets', () => {
  test('возвращает объект с items и total', async () => {
    const res = await request(app).get('/api/assets').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });
});

describe('GET /api/assets/search', () => {
  test('ищет по запросу', async () => {
    mockDb._addAsset({ model: 'HUAWEI MCLF-X', type: 'Ноутбук', serial: 'SN123TEST' });
    const res = await request(app).get('/api/assets/search?q=HUAWEI');
    expect(res.status).toBe(200);
    expect(res.body.some(a => a.model === 'HUAWEI MCLF-X')).toBe(true);
  });

  test('пустой запрос → 400', async () => {
    const res = await request(app).get('/api/assets/search');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/categories', () => {
  test('возвращает объект категорий', async () => {
    const res = await request(app).get('/api/categories').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('os');
    expect(res.body).toHaveProperty('infra');
  });
});

describe('GET /api/type-codes', () => {
  test('возвращает массив type_codes', async () => {
    const res = await request(app).get('/api/type-codes').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(t => t.code === 'NB')).toBe(true);
  });
});
