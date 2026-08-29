'use strict';
/**
 * Тесты: db.config.exportConfig / diffConfig / applyImport
 * (GET /api/config/export, POST /api/config/import/diff, /import/apply)
 *
 * До Фазы 7c-8b вся эта подсистема молча писала/читала через lowdb (cfg),
 * которая перестала обновляться ещё на Фазах 7c-2..7c-7 — фича была
 * полностью сломана и не имела вообще никакого тестового покрытия,
 * поэтому регресс никто не заметил. Этот файл — защита от повторения.
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

// ─── GET /api/config/export ─────────────────────────────────────────────────
describe('GET /api/config/export', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).get('/api/config/export');
    expect(res.status).toBe(401);
  });

  test('возвращает реальные организации/филиалы/локации из SQL (не пустой заморозенный lowdb)', async () => {
    const org = mockDb.config.createOrg({ name: 'ExportTest Org', short_code: 'EXT' });
    const filial = mockDb.config.createFilial({ name: 'ExportTest Filial', org_id: org.id });

    const res = await request(app).get('/api/config/export').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.organizations.some(o => o.id === org.id)).toBe(true);
    expect(res.body.filials.some(f => f.id === filial.id)).toBe(true);
  });

  test('включает settings.company_name, categories, type_codes, users без паролей', async () => {
    mockDb.setSetting('company_name', 'Test Company Export');
    const res = await request(app).get('/api/config/export').set(AUTH);
    expect(res.body.settings.company_name).toBe('Test Company Export');
    expect(res.body.type_codes.length).toBeGreaterThan(0);
    expect(res.body.users.length).toBeGreaterThan(0);
    expect(res.body.users[0].pin).toBeUndefined(); // пароли не экспортируются
  });
});

// ─── POST /api/config/import/diff ──────────────────────────────────────────
describe('POST /api/config/import/diff', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/config/import/diff').send({ config: {} });
    expect(res.status).toBe(401);
  });

  test('без config → 400', async () => {
    const res = await request(app).post('/api/config/import/diff').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('без organizations/filials/locations в config → 400', async () => {
    const res = await request(app).post('/api/config/import/diff').set(AUTH)
      .send({ config: { organizations: [] } }); // нет filials/locations
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/filials|locations/);
  });

  test('организация с тем же id и именем — попадает в clean, без конфликта', async () => {
    const org = mockDb.config.createOrg({ name: 'DiffClean Org', short_code: 'DFC' });
    const res = await request(app).post('/api/config/import/diff').set(AUTH).send({
      config: { organizations: [org], filials: [], locations: [] },
    });
    expect(res.status).toBe(200);
    expect(res.body.clean.organizations.some(o => o.id === org.id)).toBe(true);
    expect(res.body.conflicts.length).toBe(0);
  });

  test('организация с тем же short_code, но другим id — конфликт same_code', async () => {
    mockDb.config.createOrg({ name: 'ExistingCode Org', short_code: 'DUP1' });
    const res = await request(app).post('/api/config/import/diff').set(AUTH).send({
      config: {
        organizations: [{ id: 'incoming-fake-id', name: 'Different Name Org', short_code: 'DUP1' }],
        filials: [], locations: [],
      },
    });
    const conflict = res.body.conflicts.find(c => c.level === 'organizations');
    expect(conflict).toBeTruthy();
    expect(conflict.type).toBe('same_code');
    expect(conflict.options).toEqual(['skip','rename','replace']);
  });

  test('организация с тем же id, но другим именем — конфликт same_id_diff_data', async () => {
    const org = mockDb.config.createOrg({ name: 'OriginalName Org', short_code: 'ORIG' });
    const res = await request(app).post('/api/config/import/diff').set(AUTH).send({
      config: {
        organizations: [{ ...org, name: 'RenamedName Org' }],
        filials: [], locations: [],
      },
    });
    const conflict = res.body.conflicts.find(c => c.level === 'organizations');
    expect(conflict).toBeTruthy();
    expect(conflict.type).toBe('same_id_diff_data');
    expect(conflict.options).toEqual(['keep_current','replace']);
  });

  test('совершенно новая организация (нет ни id, ни code, ни name совпадений) — clean', async () => {
    const res = await request(app).post('/api/config/import/diff').set(AUTH).send({
      config: {
        organizations: [{ id: 'brand-new-id', name: 'Совсем Новая Уникальная Орг', short_code: 'BRND' }],
        filials: [], locations: [],
      },
    });
    expect(res.body.clean.organizations.some(o => o.short_code === 'BRND')).toBe(true);
    expect(res.body.conflicts.length).toBe(0);
  });
});

// ─── POST /api/config/import/apply ─────────────────────────────────────────
describe('POST /api/config/import/apply', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/config/import/apply').send({ clean:{}, incoming:{} });
    expect(res.status).toBe(401);
  });

  test('без clean/incoming → 400', async () => {
    const res = await request(app).post('/api/config/import/apply').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('применяет clean.organizations — новая организация реально появляется в SQL', async () => {
    const newOrg = { id: 'apply-test-new-id', name: 'ApplyTest New Org', short_code: 'APLN', status: 'active' };
    const res = await request(app).post('/api/config/import/apply').set(AUTH).send({
      clean: { organizations: [newOrg], filials: [], locations: [] },
      resolutions: [],
      incoming: {},
    });
    expect(res.status).toBe(200);
    expect(res.body.added).toContain(`organizations:${newOrg.id}`);

    const real = mockDb.config.getOrg(newOrg.id);
    expect(real).toBeTruthy();
    expect(real.name).toBe('ApplyTest New Org');
  });

  test('апсерт сохраняет ИМЕННО входящий id (кросс-инстанс синхронизация)', async () => {
    const fixedId = 'cross-instance-fixed-id-12345';
    await request(app).post('/api/config/import/apply').set(AUTH).send({
      clean: { organizations: [{ id: fixedId, name: 'Fixed Id Org', short_code: 'FXID' }], filials: [], locations: [] },
      resolutions: [], incoming: {},
    });
    const real = mockDb.config.getOrg(fixedId);
    expect(real).toBeTruthy();
    expect(real.id).toBe(fixedId); // не сгенерирован новый uuid, как делает createOrg()
  });

  test('resolution action=skip — не применяет запись', async () => {
    const existing = mockDb.config.createOrg({ name: 'SkipTest Org', short_code: 'SKIP' });
    const incomingRec = { id: 'skip-incoming-id', name: 'Different Skip Org', short_code: 'SKIP' };
    const res = await request(app).post('/api/config/import/apply').set(AUTH).send({
      clean: { organizations: [], filials: [], locations: [] },
      resolutions: [{ level: 'organizations', incoming_id: incomingRec.id, action: 'skip' }],
      incoming: { organizations: [incomingRec] },
    });
    expect(res.body.skipped).toContain(`organizations:${incomingRec.id}`);
    expect(mockDb.config.getOrg(incomingRec.id)).toBeNull();
  });

  test('resolution action=replace — обновляет существующую запись данными из incoming', async () => {
    const existing = mockDb.config.createOrg({ name: 'ReplaceTest Org Old', short_code: 'RPLC' });
    const incomingRec = { id: existing.id, name: 'ReplaceTest Org New', short_code: 'RPLC' };
    const res = await request(app).post('/api/config/import/apply').set(AUTH).send({
      clean: { organizations: [], filials: [], locations: [] },
      resolutions: [{ level: 'organizations', incoming_id: existing.id, action: 'replace' }],
      incoming: { organizations: [incomingRec] },
    });
    expect(res.body.updated).toContain(`organizations:${existing.id}`);
    const real = mockDb.config.getOrg(existing.id);
    expect(real.name).toBe('ReplaceTest Org New');
  });

  test('resolution action=rename — создаёт новую запись с новым id и переданным именем', async () => {
    const incomingRec = { id: 'rename-incoming-id', name: 'RenameTest Original', short_code: 'RNM1' };
    const res = await request(app).post('/api/config/import/apply').set(AUTH).send({
      clean: { organizations: [], filials: [], locations: [] },
      resolutions: [{ level: 'organizations', incoming_id: incomingRec.id, action: 'rename', new_name: 'RenameTest Renamed' }],
      incoming: { organizations: [incomingRec] },
    });
    expect(res.body.added.some(s => s.startsWith('organizations:'))).toBe(true);
    const orgs = mockDb.config.getOrgs(true);
    const renamed = orgs.find(o => o.name === 'RenameTest Renamed');
    expect(renamed).toBeTruthy();
    expect(renamed.id).not.toBe(incomingRec.id); // новый id, не переиспользован исходный
  });

  test('применяет categories и type_codes, если переданы в incoming', async () => {
    const res = await request(app).post('/api/config/import/apply').set(AUTH).send({
      clean: { organizations: [], filials: [], locations: [] },
      resolutions: [],
      incoming: {
        categories: { os: ['Импортированная Категория 1', 'Импортированная Категория 2'] },
        type_codes: [{ code: 'IMPX', name: 'Импорт-тип', tab: 'os' }],
      },
    });
    expect(res.body.updated).toContain('categories');
    expect(res.body.updated).toContain('type_codes');
    expect(mockDb.getCategories().os).toEqual(['Импортированная Категория 1', 'Импортированная Категория 2']);
    expect(mockDb.getTypeCodes().some(t => t.code === 'IMPX')).toBe(true);
  });

  test('сквозной цикл: export -> diff -> apply без изменений даёт пустой diff и корректный apply', async () => {
    const exported = await request(app).get('/api/config/export').set(AUTH);
    const diffRes = await request(app).post('/api/config/import/diff').set(AUTH).send({
      config: { organizations: exported.body.organizations, filials: exported.body.filials, locations: exported.body.locations },
    });
    // все записи уже существуют с теми же id/именами -> должны быть clean, без конфликтов
    expect(diffRes.body.conflicts.length).toBe(0);
  });
});
