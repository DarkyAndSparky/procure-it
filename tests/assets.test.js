'use strict';
/**
 * Тесты: CRUD ассетов, фильтрация, перемещение, списание
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
const org     = mockDb.config.createOrg({ name: 'Тест', short_code: 'TST' });
const filial  = mockDb.config.createFilial({ name: 'Офис', org_id: org.id });
const loc     = mockDb.config.createLocation({ name: 'Каб.1', filial_id: filial.id });
mockDb.config.addInvRule(org.id, { type_code: 'NB',  type_name: 'Ноутбук' });
mockDb.config.addInvRule(org.id, { type_code: 'MON', type_name: 'Монитор' });

jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

// ─── CREATE ───────────────────────────────────────────────────────────────────
describe('POST /api/assets', () => {
  test('создаёт ассет с обязательным полем model', async () => {
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'Lenovo X1', type: 'Ноутбук', tab: 'os', status: 'используется' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeTruthy();
  });

  test('без model → 400', async () => {
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ type: 'Ноутбук', tab: 'os' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Model required/);
  });

  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/assets')
      .send({ model: 'Test', tab: 'os' });
    expect(res.status).toBe(401);
  });

  test('создаёт запись в истории с action_type=add', async () => {
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'Dell XPS', type: 'Ноутбук', tab: 'os', responsible: 'Иванов' });
    const hist = mockDb._getHistory()
      .find(h => h.asset_id === res.body.id);
    expect(hist).toBeTruthy();
    expect(hist.action_type).toBe('add');
    expect(hist.to_who).toBe('Иванов');
  });

  test('созданный ассет доступен через GET /api/assets/:id', async () => {
    const create = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'HP ProBook', type: 'Ноутбук', tab: 'os' });
    const get = await request(app).get(`/api/assets/${create.body.id}`);
    expect(get.status).toBe(200);
    expect(get.body.model).toBe('HP ProBook');
  });
});

// ─── READ / FILTER ────────────────────────────────────────────────────────────
describe('GET /api/assets — фильтрация', () => {
  let nbId, monId, retiredId;

  beforeAll(async () => {
    const r1 = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'NB-FILTER', type: 'Ноутбук', tab: 'os',
              status: 'используется', org_id: org.id, filial_id: filial.id });
    nbId = r1.body.id;
    const r2 = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'MON-FILTER', type: 'Монитор', tab: 'os',
              status: 'резерв', org_id: org.id, filial_id: filial.id });
    monId = r2.body.id;
    const r3 = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'RETIRED-FILTER', type: 'Ноутбук', tab: 'os' });
    retiredId = r3.body.id;
    await request(app).delete(`/api/assets/${retiredId}`).set(AUTH);
  });

  test('по умолчанию не возвращает списанные', async () => {
    const res = await request(app).get('/api/assets').set(AUTH);
    expect(res.body.items.find(a => a.id === retiredId)).toBeUndefined();
  });

  test('фильтр по tab=os', async () => {
    const res = await request(app).get('/api/assets?tab=os');
    expect(res.body.items.every(a => a.tab === 'os')).toBe(true);
  });

  test('фильтр по status=резерв', async () => {
    const res = await request(app).get('/api/assets?status=резерв');
    expect(res.body.items.every(a => a.status === 'резерв')).toBe(true);
    expect(res.body.items.some(a => a.id === monId)).toBe(true);
  });

  test('GET /api/assets/:id → 404 для несуществующего', async () => {
    const res = await request(app).get('/api/assets/non-existent-id');
    expect(res.status).toBe(404);
  });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────
describe('PUT /api/assets/:id', () => {
  let assetId;
  beforeAll(async () => {
    const r = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'Update-Test', type: 'Ноутбук', tab: 'os', status: 'используется' });
    assetId = r.body.id;
  });

  test('обновляет поля ассета', async () => {
    const res = await request(app).put(`/api/assets/${assetId}`).set(AUTH)
      .send({ model: 'Updated Model', status: 'резерв', note: 'Тест заметка' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const get = await request(app).get(`/api/assets/${assetId}`);
    expect(get.body.model).toBe('Updated Model');
    expect(get.body.status).toBe('резерв');
    expect(get.body.note).toBe('Тест заметка');
  });

  test('обновляет updated_at', async () => {
    const before = mockDb._getAsset(assetId).updated_at;
    await new Promise(r => setTimeout(r, 10));
    await request(app).put(`/api/assets/${assetId}`).set(AUTH).send({ note: 'новая заметка' });
    const after = mockDb._getAsset(assetId).updated_at;
    expect(after > before).toBe(true);
  });

  test('404 для несуществующего ассета', async () => {
    const res = await request(app).put('/api/assets/fake-id').set(AUTH)
      .send({ model: 'X' });
    expect(res.status).toBe(404);
  });

  test('без авторизации → 401', async () => {
    const res = await request(app).put(`/api/assets/${assetId}`)
      .send({ model: 'Hacked' });
    expect(res.status).toBe(401);
  });
});

// ─── DELETE (списание) ────────────────────────────────────────────────────────
describe('DELETE /api/assets/:id — списание', () => {
  let assetId;
  beforeAll(async () => {
    const r = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'ToRetire', type: 'Монитор', tab: 'os',
              responsible: 'Петров', status: 'используется' });
    assetId = r.body.id;
  });

  test('меняет статус на списан, не удаляет физически', async () => {
    const res = await request(app).delete(`/api/assets/${assetId}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const asset = mockDb._getAsset(assetId);
    expect(asset).toBeTruthy();
    expect(asset.status).toBe('списан');
  });

  test('создаёт запись истории с action_type=retire', async () => {
    const hist = mockDb._getHistory()
      .find(h => h.asset_id === assetId && h.action_type === 'retire');
    expect(hist).toBeTruthy();
    expect(hist.reason).toMatch(/Списание/);
  });

  test('списанный не возвращается в GET /api/assets', async () => {
    const res = await request(app).get('/api/assets').set(AUTH);
    expect(res.body.items.find(a => a.id === assetId)).toBeUndefined();
  });

  test('404 для несуществующего', async () => {
    const res = await request(app).delete('/api/assets/fake-id').set(AUTH);
    expect(res.status).toBe(404);
  });
});

// ─── MOVE ─────────────────────────────────────────────────────────────────────
describe('POST /api/assets/:id/move', () => {
  let assetId;
  beforeAll(async () => {
    const r = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'MoveMe', type: 'Ноутбук', tab: 'os',
              responsible: 'Сидоров', filial: 'Москва', status: 'используется' });
    assetId = r.body.id;
  });

  test('перемещает ответственного и локацию', async () => {
    const res = await request(app).post(`/api/assets/${assetId}/move`).set(AUTH)
      .send({ newResponsible: 'Козлов', newFilial: 'Питер', reason: 'Командировка' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const asset = mockDb._getAsset(assetId);
    expect(asset.responsible).toBe('Козлов');
    expect(asset.filial).toBe('Питер');
  });

  test('создаёт запись истории с action_type=move', async () => {
    const hist = mockDb._getHistory()
      .filter(h => h.asset_id === assetId && h.action_type === 'move');
    expect(hist.length).toBeGreaterThan(0);
    const last = hist[hist.length - 1];
    expect(last.to_who).toBe('Козлов');
    expect(last.action_type).toBe('move');
    expect(last.reason).toMatch(/Командировка/);
  });

  test('пустые поля не затирают существующие значения', async () => {
    const before = mockDb._getAsset(assetId);
    await request(app).post(`/api/assets/${assetId}/move`).set(AUTH)
      .send({ newResponsible: 'Новый' }); // filial не передаём
    const after = mockDb._getAsset(assetId);
    expect(after.filial).toBe(before.filial); // не изменился
    expect(after.responsible).toBe('Новый');
  });

  test('404 для несуществующего ассета', async () => {
    const res = await request(app).post('/api/assets/fake-id/move').set(AUTH)
      .send({ newResponsible: 'X' });
    expect(res.status).toBe(404);
  });
});

// ─── ИНВЕНТАРНЫЕ НОМЕРА ───────────────────────────────────────────────────────
describe('GET /api/inv/next', () => {
  test('возвращает следующий инв. номер по org_id и type', async () => {
    const res = await request(app)
      .get(`/api/inv/next?org_id=${org.id}&type=NB`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.inv).toMatch(/^TST-NB-\d{5}$/);
  });

  test('поиск по short_code (legacy ?org=TST)', async () => {
    const res = await request(app)
      .get(`/api/inv/next?org=TST&type=NB`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.inv).toMatch(/^TST-NB-\d{5}$/);
  });

  test('без type → 400', async () => {
    const res = await request(app).get(`/api/inv/next?org_id=${org.id}`).set(AUTH);
    expect(res.status).toBe(400);
  });

  test('несуществующий org → 404', async () => {
    const res = await request(app).get('/api/inv/next?org=FAKE&type=NB').set(AUTH);
    expect(res.status).toBe(404);
  });

  test('тип не настроен для org → 400', async () => {
    const res = await request(app)
      .get(`/api/inv/next?org_id=${org.id}&type=TAB`)
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  test('GET /next — идемпотентен, не резервирует (счётчик не растёт)', async () => {
    const r1 = await request(app).get(`/api/inv/next?org_id=${org.id}&type=MON`).set(AUTH);
    const r2 = await request(app).get(`/api/inv/next?org_id=${org.id}&type=MON`).set(AUTH);
    expect(r2.body.next).toBe(r1.body.next);
  });

  test('POST /reserve — инкрементирует счётчик при каждом вызове', async () => {
    const r1 = await request(app).post('/api/inv/reserve').set(AUTH).send({ org_id: org.id, type: 'MON' });
    const r2 = await request(app).post('/api/inv/reserve').set(AUTH).send({ org_id: org.id, type: 'MON' });
    expect(r2.body.next).toBe(r1.body.next + 1);
  });
});
