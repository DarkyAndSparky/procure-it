'use strict';
/**
 * Тесты: db.config — организации, филиалы, локации
 */
const makeDb = require('./helpers/makeDb');

describe('db.config — Организации', () => {
  let db;
  beforeEach(() => { db = makeDb(); });

  test('createOrg — создаёт организацию с правильными полями', () => {
    const org = db.config.createOrg({ name: 'Тест', short_code: 'TST' });
    expect(org.name).toBe('Тест');
    expect(org.short_code).toBe('TST');
    expect(org.status).toBe('active');
    expect(org.system).toBe(false);
    expect(org.id).toBeTruthy();
  });

  test('createOrg — приводит short_code к верхнему регистру', () => {
    const org = db.config.createOrg({ name: 'Тест2', short_code: 'tst2' });
    expect(org.short_code).toBe('TST2');
  });

  test('createOrg — бросает ошибку при дублировании имени', () => {
    db.config.createOrg({ name: 'Дубль', short_code: 'DBL' });
    expect(() => db.config.createOrg({ name: 'Дубль', short_code: 'DB2' }))
      .toThrow(/Дублирует/);
  });

  test('createOrg — бросает ошибку при дублировании кода', () => {
    db.config.createOrg({ name: 'Орг А', short_code: 'ORG' });
    expect(() => db.config.createOrg({ name: 'Орг Б', short_code: 'ORG' }))
      .toThrow(/Дублирует/);
  });

  test('createOrg — бросает ошибку без name или short_code', () => {
    expect(() => db.config.createOrg({ name: 'Без кода' })).toThrow();
    expect(() => db.config.createOrg({ short_code: 'BEZ' })).toThrow();
  });

  test('getOrgs — не возвращает системные записи по умолчанию', () => {
    db.config.createOrg({ name: 'Реальная', short_code: 'REL' });
    const orgs = db.config.getOrgs();
    expect(orgs.every(o => !o.system)).toBe(true);
    expect(orgs.length).toBe(1);
  });

  test('getOrgs — возвращает системные при includeSystem=true', () => {
    const orgs = db.config.getOrgs(true);
    expect(orgs.some(o => o.id === 'sys-org-unk')).toBe(true);
  });

  test('getOrg — находит по id', () => {
    const created = db.config.createOrg({ name: 'Найди меня', short_code: 'FND' });
    const found = db.config.getOrg(created.id);
    expect(found.name).toBe('Найди меня');
  });

  test('getOrg — возвращает null для несуществующего id', () => {
    expect(db.config.getOrg('non-existent-id')).toBeNull();
  });

  test('updateOrg — обновляет поля', () => {
    const org = db.config.createOrg({ name: 'Старое', short_code: 'OLD' });
    const updated = db.config.updateOrg(org.id, { name: 'Новое' });
    expect(updated.name).toBe('Новое');
    expect(updated.short_code).toBe('OLD'); // не менялся
  });

  test('updateOrg — запрещает изменять системную запись', () => {
    expect(() => db.config.updateOrg('sys-org-unk', { name: 'Хак' }))
      .toThrow(/системную/);
  });

  test('renameOrg — переименовывает и пишет историю', () => {
    const org = db.config.createOrg({ name: 'Оригинал', short_code: 'ORG' });
    db.config.renameOrg(org.id, 'Новое название');
    const updated = db.config.getOrg(org.id);
    expect(updated.name).toBe('Новое название');
    expect(updated.renamed_from).toBe('Оригинал');
    const hist = db._getHistory();
    expect(hist.some(h => h.action_type === 'org_renamed')).toBe(true);
  });

  test('renameOrg — запрещает переименовывать системную запись', () => {
    expect(() => db.config.renameOrg('sys-org-unk', 'Хак')).toThrow(/системную/);
  });
});

describe('db.config — Филиалы', () => {
  let db;
  beforeEach(() => { db = makeDb(); });

  test('createFilial — создаёт филиал', () => {
    const filial = db.config.createFilial({ name: 'Главный офис', address: 'ул. Ленина, 1' });
    expect(filial.name).toBe('Главный офис');
    expect(filial.address).toBe('ул. Ленина, 1');
    expect(filial.status).toBe('active');
    expect(filial.system).toBe(false);
  });

  test('createFilial — бросает ошибку без name', () => {
    expect(() => db.config.createFilial({ address: 'Адрес' })).toThrow(/обязателен/);
  });

  test('updateFilial — обновляет name и address', () => {
    const f = db.config.createFilial({ name: 'Старый' });
    const updated = db.config.updateFilial(f.id, { name: 'Новый', address: 'ул. Мира, 5' });
    expect(updated.name).toBe('Новый');
    expect(updated.address).toBe('ул. Мира, 5');
  });

  test('updateFilial — запрещает изменять системный филиал', () => {
    expect(() => db.config.updateFilial('sys-filial-unk', { name: 'Хак' }))
      .toThrow(/системную/);
  });

  test('closeFilial — закрывает филиал', () => {
    const f = db.config.createFilial({ name: 'Закрыть' });
    const result = db.config.closeFilial(f.id);
    expect(result.closed).toBe(true);
    const updated = db.config.getFilial(f.id);
    expect(updated.status).toBe('closed');
    expect(updated.closed_at).toBeTruthy();
  });

  test('closeFilial — считает затронутые ассеты', () => {
    const f = db.config.createFilial({ name: 'С ассетами' });
    db._addAsset({ filial_id: f.id, status: 'используется' });
    db._addAsset({ filial_id: f.id, status: 'резерв' });
    db._addAsset({ filial_id: f.id, status: 'списан' }); // не считается
    const result = db.config.closeFilial(f.id);
    expect(result.affected_assets).toBe(2);
  });

  test('closeFilial — запрещает закрывать системный филиал', () => {
    expect(() => db.config.closeFilial('sys-filial-unk')).toThrow(/системную/);
  });
});

describe('db.config — Локации', () => {
  let db;
  let testFilial;
  beforeEach(() => {
    db = makeDb();
    testFilial = db.config.createFilial({ name: 'Офис' });
  });

  test('createLocation — создаёт локацию', () => {
    const loc = db.config.createLocation({ name: 'Кабинет 101', filial_id: testFilial.id });
    expect(loc.name).toBe('Кабинет 101');
    expect(loc.filial_id).toBe(testFilial.id);
    expect(loc.type).toBe('office');
  });

  test('createLocation — бросает ошибку без name или filial_id', () => {
    expect(() => db.config.createLocation({ name: 'Без филиала' })).toThrow();
    expect(() => db.config.createLocation({ filial_id: testFilial.id })).toThrow();
  });

  test('getLocations — фильтрует по filial_id', () => {
    const f2 = db.config.createFilial({ name: 'Склад' });
    db.config.createLocation({ name: 'Офис 1', filial_id: testFilial.id });
    db.config.createLocation({ name: 'Склад 1', filial_id: f2.id });
    const locs = db.config.getLocations(testFilial.id);
    expect(locs.length).toBe(1);
    expect(locs[0].name).toBe('Офис 1');
  });

  test('getLocations — не возвращает системные по умолчанию', () => {
    const locs = db.config.getLocations(null, false);
    expect(locs.every(l => !l.system)).toBe(true);
  });
});
