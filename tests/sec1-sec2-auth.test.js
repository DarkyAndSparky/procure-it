'use strict';
/**
 * Тесты: SEC-1 (принудительная смена дефолтного PIN админа) и
 * SEC-2 (пустой PIN не даёт прав выше viewer).
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

describe('SEC-2 — пустой PIN ограничивает роль viewer', () => {
  test('операторy с пустым PIN не даёт создавать активы', async () => {
    const op = mockDb.createUser({ name: 'Empty Op', login: 'emptyop', role: 'operator', pin: '' });

    const auth = await request(app).post('/api/users/auth').send({ user_id: op.id, pin: '' });
    expect(auth.status).toBe(200);
    expect(auth.body.user.role).toBe('viewer'); // роль в ответе уже урезана

    const create = await request(app).post('/api/assets')
      .set({ 'x-user-id': op.id, 'x-edit-password': '' })
      .send({ model: 'X', type: 'Ноутбук', tab: 'os', responsible: 'Т', status: 'используется' });
    expect(create.status).toBe(403); // requireAuth блокирует как viewer
  });

  test('админу с пустым PIN не даёт прав администратора', async () => {
    const admin2 = mockDb.createUser({ name: 'Empty Admin', login: 'emptyadmin', role: 'admin', pin: '' });

    const del = await request(app).delete(`/api/users/${admin2.id}`)
      .set({ 'x-user-id': admin2.id, 'x-edit-password': '' });
    expect(del.status).toBe(403);
  });

  test('viewer с пустым PIN по-прежнему может логиниться как viewer (фича без пароля)', async () => {
    const viewer = mockDb.createUser({ name: 'Viewer NoPin', login: 'viewernp', role: 'viewer', pin: '' });
    const auth = await request(app).post('/api/users/auth').send({ user_id: viewer.id, pin: '' });
    expect(auth.status).toBe(200);
    expect(auth.body.user.role).toBe('viewer');
  });
});

describe('SEC-1 — дефолтный PIN админа блокирует остальные действия', () => {
  test('login под дефолтным PIN отдаёт must_change_pin: true', async () => {
    // makeDb() меняет pin sys-user-admin на 'test123' для остальных тестов —
    // здесь возвращаем дефолтный PIN явно, чтобы проверить блокировку.
    mockDb.updateUser('sys-user-admin', { pin: 'admn0000' });

    const login = await request(app).post('/api/users/login').send({ login: 'admin', password: 'admn0000' });
    expect(login.status).toBe(200);
    expect(login.body.must_change_pin).toBe(true);

    const AUTH = { 'x-user-id': login.body.user.id, 'x-edit-password': 'admn0000' };

    // Любое другое привилегированное действие — заблокировано
    const create = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'X', type: 'Ноутбук', tab: 'os', responsible: 'Т', status: 'используется' });
    expect(create.status).toBe(428);
    expect(create.body.must_change_pin).toBe(true);

    // Но сменить свой же PIN — можно
    const changePin = await request(app).put(`/api/users/${login.body.user.id}`).set(AUTH)
      .send({ pin: 'newSecurePin1' });
    expect(changePin.status).toBe(200);

    // После смены PIN блокировка снята
    const AUTH2 = { 'x-user-id': login.body.user.id, 'x-edit-password': 'newSecurePin1' };
    const create2 = await request(app).post('/api/assets').set(AUTH2)
      .send({ model: 'X', type: 'Ноутбук', tab: 'os', responsible: 'Т', status: 'используется' });
    expect(create2.status).toBe(200);

    // Возвращаем состояние, ожидаемое остальными тестами файла/сьюта
    mockDb.updateUser('sys-user-admin', { pin: 'test123' });
  });
});
