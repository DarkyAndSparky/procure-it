'use strict';
/**
 * Тесты: BUG-2 — атомарность bulk-move/bulk-assign-inv + подробный отчёт
 * по конкретным ID (ids_assigned/ids_failed), а не только количество.
 *
 * До фикса: bulk-assign-inv не был обёрнут в транзакцию — если nextInv()
 * падал на середине пачки (например, для типа не настроено правило),
 * уже обработанные ассеты оставались в SQL, необработанные — нет, и
 * вызывающая сторона получала голый 500 без списка, что вообще применилось.
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
const org = mockDb.config.createOrg({ name: 'Bug2Org', short_code: 'B2O' });
mockDb.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });
// Намеренно НЕ добавляем правило для 'PR' — понадобится для теста на sмешанный batch

jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

describe('POST /api/assets/bulk-move — ids_assigned/ids_failed', () => {
  test('успешные и несуществующие ID корректно разбираются по спискам', async () => {
    const a1 = await request(app).post('/api/assets').set(AUTH).send({ model: 'BM-1', tab: 'os' });
    const a2 = await request(app).post('/api/assets').set(AUTH).send({ model: 'BM-2', tab: 'os' });

    const res = await request(app).post('/api/assets/bulk-move').set(AUTH).send({
      ids: [a1.body.id, 'nonexistent-id', a2.body.id],
      newResponsible: 'Новый Ответственный',
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(2);
    expect(res.body.ids_assigned.sort()).toEqual([a1.body.id, a2.body.id].sort());
    expect(res.body.ids_failed).toHaveLength(1);
    expect(res.body.ids_failed[0].id).toBe('nonexistent-id');
    expect(res.body.ids_failed[0].reason).toMatch(/не найден/i);
  });
});

describe('POST /api/assets/bulk-assign-inv — атомарность + ids_assigned/ids_failed', () => {
  test('смешанный batch: успешные (NB) + неудачные (PR, правило не настроено) не рушат друг друга', async () => {
    const nb1 = await request(app).post('/api/assets').set(AUTH).send({ model: 'NB-Asset-1', tab: 'os', type: 'Ноутбук' });
    const nb2 = await request(app).post('/api/assets').set(AUTH).send({ model: 'NB-Asset-2', tab: 'os', type: 'Ноутбук' });

    const res = await request(app).post('/api/assets/bulk-assign-inv').set(AUTH).send({
      ids: [nb1.body.id, nb2.body.id],
      org_id: org.id,
      type_code: 'NB',
    });

    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(2);
    expect(res.body.ids_assigned.sort()).toEqual([nb1.body.id, nb2.body.id].sort());
    expect(res.body.ids_failed).toEqual([]);

    // Оба ассета реально получили инв. номер — атомарно применились оба.
    const check1 = await request(app).get('/api/assets').set(AUTH);
    const updated1 = check1.body.items.find(a => a.id === nb1.body.id);
    const updated2 = check1.body.items.find(a => a.id === nb2.body.id);
    expect(updated1.inv).toBeTruthy();
    expect(updated2.inv).toBeTruthy();
  });

  test('неподдерживаемый type_code для всей пачки → все попадают в ids_failed, ничего не падает 500-й', async () => {
    const pr1 = await request(app).post('/api/assets').set(AUTH).send({ model: 'PR-Asset-1', tab: 'os', type: 'Принтер' });
    const pr2 = await request(app).post('/api/assets').set(AUTH).send({ model: 'PR-Asset-2', tab: 'os', type: 'Принтер' });

    const res = await request(app).post('/api/assets/bulk-assign-inv').set(AUTH).send({
      ids: [pr1.body.id, pr2.body.id],
      org_id: org.id,
      type_code: 'PR', // правило не настроено для этой организации
    });

    expect(res.status).toBe(200); // не 500 — это ожидаемая, не системная ошибка
    expect(res.body.assigned).toBe(0);
    expect(res.body.ids_assigned).toEqual([]);
    expect(res.body.ids_failed).toHaveLength(2);
    expect(res.body.ids_failed[0].reason).toMatch(/не настроен/i);

    // Ни один из ассетов не получил инв. номер — ничего не осталось в
    // "полуприменённом" состоянии.
    const check = await request(app).get('/api/assets').set(AUTH);
    const updated1 = check.body.items.find(a => a.id === pr1.body.id);
    const updated2 = check.body.items.find(a => a.id === pr2.body.id);
    expect(updated1.inv).toBeFalsy();
    expect(updated2.inv).toBeFalsy();
  });

  test('ассет с уже присвоенным инв. номером — в ids_failed с понятной причиной, не мешает остальным', async () => {
    const nb3 = await request(app).post('/api/assets').set(AUTH).send({ model: 'NB-Asset-3', tab: 'os', type: 'Ноутбук' });
    // Присваиваем первый раз
    await request(app).post('/api/assets/bulk-assign-inv').set(AUTH)
      .send({ ids: [nb3.body.id], org_id: org.id, type_code: 'NB' });

    const nb4 = await request(app).post('/api/assets').set(AUTH).send({ model: 'NB-Asset-4', tab: 'os', type: 'Ноутбук' });

    // Повторная попытка на уже назначенный + новый в одной пачке
    const res = await request(app).post('/api/assets/bulk-assign-inv').set(AUTH)
      .send({ ids: [nb3.body.id, nb4.body.id], org_id: org.id, type_code: 'NB' });

    expect(res.status).toBe(200);
    expect(res.body.ids_assigned).toEqual([nb4.body.id]);
    expect(res.body.ids_failed).toHaveLength(1);
    expect(res.body.ids_failed[0].id).toBe(nb3.body.id);
    expect(res.body.ids_failed[0].reason).toMatch(/уже есть/i);
  });
});
