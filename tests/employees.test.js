'use strict';
/**
 * Тесты: CRUD сотрудников, поиск, увольнение с перемещением активов
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();

jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

// ─── CREATE ───────────────────────────────────────────────────────────────────
describe('POST /api/employees', () => {
  test('создаёт сотрудника с обязательным полем name', async () => {
    const res = await request(app).post('/api/employees').set(AUTH)
      .send({ name: 'Иванов Иван', dept: 'IT', phone: '+70000000000' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('Иванов Иван');
    expect(res.body.active).toBe(true);
  });

  test('без name → 400', async () => {
    const res = await request(app).post('/api/employees').set(AUTH)
      .send({ dept: 'IT' });
    expect(res.status).toBe(400);
  });

  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/employees')
      .send({ name: 'Тест Тестов' });
    expect(res.status).toBe(401);
  });
});

// ─── READ ─────────────────────────────────────────────────────────────────────
describe('GET /api/employees', () => {
  let emp;
  beforeAll(async () => {
    const res = await request(app).post('/api/employees').set(AUTH)
      .send({ name: 'Петров Пётр', dept: 'Бухгалтерия' });
    emp = res.body;
  });

  test('возвращает список активных сотрудников', async () => {
    const res = await request(app).get('/api/employees').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find(e => e.id === emp.id)).toBeTruthy();
  });

  test('без авторизации (нет x-user-id) → 401', async () => {
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(401);
  });

  test('поиск ?q=... возвращает совпадения', async () => {
    const res = await request(app).get('/api/employees?q=Петров').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.some(e => e.id === emp.id)).toBe(true);
  });

  test('поиск ?q=... короче 2 символов возвращает пусто', async () => {
    const res = await request(app).get('/api/employees?q=П').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('GET /api/employees/:id — существующий', async () => {
    const res = await request(app).get(`/api/employees/${emp.id}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(emp.id);
  });

  test('GET /api/employees/:id — несуществующий → 404', async () => {
    const res = await request(app).get('/api/employees/no-such-id').set(AUTH);
    expect(res.status).toBe(404);
  });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────
describe('PUT /api/employees/:id', () => {
  let emp;
  beforeEach(async () => {
    const res = await request(app).post('/api/employees').set(AUTH)
      .send({ name: 'Сидоров Сидор', dept: 'IT' });
    emp = res.body;
  });

  test('обновляет поля', async () => {
    const res = await request(app).put(`/api/employees/${emp.id}`).set(AUTH)
      .send({ dept: 'Продажи', phone: '+79990001122' });
    expect(res.status).toBe(200);
    expect(res.body.dept).toBe('Продажи');
    expect(res.body.phone).toBe('+79990001122');
  });

  test('несуществующий сотрудник → 404', async () => {
    const res = await request(app).put('/api/employees/no-such-id').set(AUTH)
      .send({ dept: 'X' });
    expect(res.status).toBe(404);
  });

  test('без авторизации → 401', async () => {
    const res = await request(app).put(`/api/employees/${emp.id}`)
      .send({ dept: 'X' });
    expect(res.status).toBe(401);
  });
});

// ─── DELETE (деактивация) ─────────────────────────────────────────────────────
describe('DELETE /api/employees/:id', () => {
  test('деактивирует сотрудника вместо удаления', async () => {
    const created = await request(app).post('/api/employees').set(AUTH)
      .send({ name: 'Уволенный Сотрудник' });

    const res = await request(app).delete(`/api/employees/${created.body.id}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deactivated).toBe(true);

    // Сотрудник больше не приходит в списке активных...
    const list = await request(app).get('/api/employees').set(AUTH);
    expect(list.body.find(e => e.id === created.body.id)).toBeUndefined();

    // ...но доступен явным запросом активных=false
    const listAll = await request(app).get('/api/employees?active=false').set(AUTH);
    const found = listAll.body.find(e => e.id === created.body.id);
    expect(found).toBeTruthy();
    expect(found.active).toBe(false);
  });

  test('несуществующий сотрудник → 404', async () => {
    const res = await request(app).delete('/api/employees/no-such-id').set(AUTH);
    expect(res.status).toBe(404);
  });

  test('без авторизации → 401', async () => {
    const created = await request(app).post('/api/employees').set(AUTH)
      .send({ name: 'Ещё Один' });
    const res = await request(app).delete(`/api/employees/${created.body.id}`);
    expect(res.status).toBe(401);
  });
});

// ─── REASSIGN ASSETS ───────────────────────────────────────────────────────────
describe('POST /api/employees/:id/reassign-assets', () => {
  let empFrom, empTo, assetId;

  beforeEach(async () => {
    const from = await request(app).post('/api/employees').set(AUTH).send({ name: 'Отдающий Сотрудник' });
    const to   = await request(app).post('/api/employees').set(AUTH).send({ name: 'Принимающий Сотрудник' });
    empFrom = from.body; empTo = to.body;

    const asset = await request(app).post('/api/assets').set(AUTH).send({
      model: 'Lenovo X1', type: 'Ноутбук', tab: 'os', status: 'используется',
      responsible: empFrom.name,
    });
    assetId = asset.body.id;
  });

  test('перемещает активы на другого сотрудника', async () => {
    const res = await request(app)
      .post(`/api/employees/${empFrom.id}/reassign-assets`).set(AUTH)
      .send({ to_employee_id: empTo.id });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.moved).toBe(1);

    const asset = await request(app).get(`/api/assets/${assetId}`).set(AUTH);
    expect(asset.body.responsible).toBe(empTo.name);
  });

  test('без to_employee_id — оставляет активы без ответственного', async () => {
    const res = await request(app)
      .post(`/api/employees/${empFrom.id}/reassign-assets`).set(AUTH)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.left_unassigned).toBe(1);

    const asset = await request(app).get(`/api/assets/${assetId}`).set(AUTH);
    expect(asset.body.responsible).toBe('');
  });

  test('нет активов у сотрудника → moved: 0', async () => {
    const emptyEmp = await request(app).post('/api/employees').set(AUTH).send({ name: 'Без Активов' });
    const res = await request(app)
      .post(`/api/employees/${emptyEmp.body.id}/reassign-assets`).set(AUTH)
      .send({ to_employee_id: empTo.id });
    expect(res.status).toBe(200);
    expect(res.body.moved).toBe(0);
    expect(res.body.left_unassigned).toBe(0);
  });

  test('несуществующий сотрудник → 404', async () => {
    const res = await request(app)
      .post('/api/employees/no-such-id/reassign-assets').set(AUTH)
      .send({ to_employee_id: empTo.id });
    expect(res.status).toBe(404);
  });

  test('без авторизации → 401', async () => {
    const res = await request(app)
      .post(`/api/employees/${empFrom.id}/reassign-assets`)
      .send({ to_employee_id: empTo.id });
    expect(res.status).toBe(401);
  });
});
