'use strict';
/**
 * Тесты: инвентарные номера и ликвидация организаций
 */
const makeDb = require('./helpers/makeDb');

describe('Инвентарные номера — addInvRule', () => {
  let db, org;
  beforeEach(() => {
    db = makeDb();
    org = db.config.createOrg({ name: 'ЯРКО', short_code: 'YRK' });
  });

  test('addInvRule — добавляет правило', () => {
    const rule = db.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });
    expect(rule.type_code).toBe('NB');
    expect(rule.type_name).toBe('Ноутбук');
    expect(rule.counter).toBe(0);
    expect(rule.active).toBe(true);
  });

  test('addInvRule — приводит code к верхнему регистру', () => {
    const rule = db.config.addInvRule(org.id, { type_code: 'nb', type_name: 'Ноутбук' });
    expect(rule.type_code).toBe('NB');
  });

  test('addInvRule — бросает ошибку при дублировании кода', () => {
    db.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });
    expect(() => db.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноут 2' }))
      .toThrow(/уже существует/);
  });

  test('addInvRule — запрещает добавлять к системной org', () => {
    expect(() => db.config.addInvRule('sys-org-unk', { type_code: 'NB', type_name: 'NB' }))
      .toThrow(/системной/);
  });

  test('addInvRule — бросает для несуществующей org', () => {
    expect(() => db.config.addInvRule('fake-id', { type_code: 'NB', type_name: 'NB' }))
      .toThrow(/не найдена/);
  });
});

describe('Инвентарные номера — nextInv', () => {
  let db, org;
  beforeEach(() => {
    db = makeDb();
    org = db.config.createOrg({ name: 'ЯРКО', short_code: 'YRK' });
    db.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });
    db.config.addInvRule(org.id, { type_code: 'MON', type_name: 'Монитор' });
  });

  test('nextInv — выдаёт первый номер YRK-NB-00001', () => {
    const result = db.config.nextInv(org.id, 'NB');
    expect(result.inv).toBe('YRK-NB-00001');
    expect(result.next).toBe(1);
  });

  test('nextInv — инкрементирует счётчик последовательно', () => {
    const r1 = db.config.nextInv(org.id, 'NB');
    const r2 = db.config.nextInv(org.id, 'NB');
    const r3 = db.config.nextInv(org.id, 'NB');
    expect(r1.inv).toBe('YRK-NB-00001');
    expect(r2.inv).toBe('YRK-NB-00002');
    expect(r3.inv).toBe('YRK-NB-00003');
  });

  test('nextInv — разные типы не влияют друг на друга', () => {
    db.config.nextInv(org.id, 'NB');
    db.config.nextInv(org.id, 'NB');
    const mon = db.config.nextInv(org.id, 'MON');
    expect(mon.inv).toBe('YRK-MON-00001');
  });

  test('nextInv — учитывает существующие ассеты при старте', () => {
    // Есть ассет с номером YRK-NB-00005, счётчик должен начать с 6
    db._addAsset({ inv: 'YRK-NB-00005', org_id: org.id });
    const result = db.config.nextInv(org.id, 'NB');
    expect(result.inv).toBe('YRK-NB-00006');
  });

  test('nextInv — бросает ошибку если тип не настроен', () => {
    expect(() => db.config.nextInv(org.id, 'TAB')).toThrow(/не настроен/);
  });

  test('nextInv — бросает ошибку для отключённого правила', () => {
    db.config.toggleInvRule(org.id, 'NB', false);
    expect(() => db.config.nextInv(org.id, 'NB')).toThrow(/не настроен/);
  });
});

describe('Инвентарные номера — toggleInvRule / renameInvRule', () => {
  let db, org;
  beforeEach(() => {
    db = makeDb();
    org = db.config.createOrg({ name: 'ЯРКО', short_code: 'YRK' });
    db.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });
  });

  test('toggleInvRule — отключает правило', () => {
    db.config.toggleInvRule(org.id, 'NB', false);
    const updated = db.config.getOrg(org.id);
    const rule = updated.inv_rules.find(r => r.type_code === 'NB');
    expect(rule.active).toBe(false);
  });

  test('toggleInvRule — включает обратно', () => {
    db.config.toggleInvRule(org.id, 'NB', false);
    db.config.toggleInvRule(org.id, 'NB', true);
    const updated = db.config.getOrg(org.id);
    const rule = updated.inv_rules.find(r => r.type_code === 'NB');
    expect(rule.active).toBe(true);
  });

  test('renameInvRule — переименовывает', () => {
    db.config.renameInvRule(org.id, 'NB', { type_name: 'Лэптоп' });
    const updated = db.config.getOrg(org.id);
    const rule = updated.inv_rules.find(r => r.type_code === 'NB');
    expect(rule.type_name).toBe('Лэптоп');
  });

  test('renameInvRule — бросает ошибку при пустом имени', () => {
    expect(() => db.config.renameInvRule(org.id, 'NB', { type_name: '' }))
      .toThrow(/обязателен/);
    expect(() => db.config.renameInvRule(org.id, 'NB', { type_name: '   ' }))
      .toThrow(/обязателен/);
  });

  test('renameInvRule — бросает ошибку для несуществующего кода', () => {
    expect(() => db.config.renameInvRule(org.id, 'TAB', { type_name: 'Планшет' }))
      .toThrow(/не найдено/);
  });
});

describe('Инвентарные номера — deleteInvRule', () => {
  let db, org;
  beforeEach(() => {
    db = makeDb();
    org = db.config.createOrg({ name: 'ЯРКО', short_code: 'YRK' });
    db.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });
    db.config.addInvRule(org.id, { type_code: 'MON', type_name: 'Монитор' });
  });

  test('deleteInvRule — удаляет правило без ассетов', () => {
    const result = db.config.deleteInvRule(org.id, 'NB');
    expect(result.ok).toBe(true);
    const updated = db.config.getOrg(org.id);
    expect(updated.inv_rules.find(r => r.type_code === 'NB')).toBeUndefined();
  });

  test('deleteInvRule — возвращает conflict при наличии ассетов', () => {
    db._addAsset({ inv: 'YRK-NB-00001', org_id: org.id });
    db._addAsset({ inv: 'YRK-NB-00002', org_id: org.id });
    const result = db.config.deleteInvRule(org.id, 'NB');
    expect(result.conflict).toBe(true);
    expect(result.count).toBe(2);
    expect(result.prefix).toBe('YRK-NB-');
  });

  test('deleteInvRule — не удаляет при conflict', () => {
    db._addAsset({ inv: 'YRK-NB-00001', org_id: org.id });
    db.config.deleteInvRule(org.id, 'NB');
    // правило должно остаться
    const updated = db.config.getOrg(org.id);
    expect(updated.inv_rules.find(r => r.type_code === 'NB')).toBeTruthy();
  });

  test('deleteInvRuleForce reset — обнуляет inv у ассетов и удаляет правило', () => {
    const a1 = db._addAsset({ inv: 'YRK-NB-00001', org_id: org.id });
    const a2 = db._addAsset({ inv: 'YRK-NB-00002', org_id: org.id });
    db.config.deleteInvRuleForce(org.id, 'NB', 'reset');
    const assets = db._getAssets();
    expect(assets.find(a => a.id === a1.id).inv).toBe('');
    expect(assets.find(a => a.id === a2.id).inv).toBe('');
    const updated = db.config.getOrg(org.id);
    expect(updated.inv_rules.find(r => r.type_code === 'NB')).toBeUndefined();
  });

  test('deleteInvRuleForce transfer — переносит номера на другое правило', () => {
    const a1 = db._addAsset({ inv: 'YRK-NB-00001', org_id: org.id });
    const a2 = db._addAsset({ inv: 'YRK-NB-00002', org_id: org.id });
    // У MON уже есть один ассет с 00001
    db._addAsset({ inv: 'YRK-MON-00001', org_id: org.id });
    db.config.deleteInvRuleForce(org.id, 'NB', 'transfer', 'MON');
    const assets = db._getAssets();
    const newA1 = assets.find(a => a.id === a1.id).inv;
    const newA2 = assets.find(a => a.id === a2.id).inv;
    // Должны быть YRK-MON-00002 и YRK-MON-00003
    expect(newA1).toBe('YRK-MON-00002');
    expect(newA2).toBe('YRK-MON-00003');
    // Счётчик MON обновился
    const updatedOrg = db.config.getOrg(org.id);
    const monRule = updatedOrg.inv_rules.find(r => r.type_code === 'MON');
    expect(monRule.counter).toBe(3);
    // Правило NB удалено
    expect(updatedOrg.inv_rules.find(r => r.type_code === 'NB')).toBeUndefined();
  });

  test('deleteInvRuleForce transfer — бросает ошибку для отключённого целевого правила', () => {
    db._addAsset({ inv: 'YRK-NB-00001', org_id: org.id });
    db.config.toggleInvRule(org.id, 'MON', false);
    expect(() => db.config.deleteInvRuleForce(org.id, 'NB', 'transfer', 'MON'))
      .toThrow(/не найдено/);
  });

  test('deleteInvRuleForce — бросает ошибку для неизвестного action', () => {
    expect(() => db.config.deleteInvRuleForce(org.id, 'NB', 'unknown'))
      .toThrow(/Неизвестный action/);
  });
});

describe('Ликвидация организации — liquidateOrg', () => {
  let db, orgA, orgB;
  beforeEach(() => {
    db = makeDb();
    orgA = db.config.createOrg({ name: 'Альфа', short_code: 'ALF' });
    orgB = db.config.createOrg({ name: 'Бета',  short_code: 'BET' });
    db.config.addInvRule(orgA.id, { type_code: 'NB',  type_name: 'Ноутбук' });
    db.config.addInvRule(orgB.id, { type_code: 'NB',  type_name: 'Ноутбук' });
  });

  test('liquidateOrg — переносит активные ассеты в целевую org', () => {
    db._addAsset({ org_id: orgA.id, status: 'используется', model: 'NB-1', type: 'Ноутбук', serial: 's1' });
    db._addAsset({ org_id: orgA.id, status: 'резерв',       model: 'NB-2', type: 'Ноутбук', serial: 's2' });
    db._addAsset({ org_id: orgA.id, status: 'списан',       model: 'NB-3', type: 'Ноутбук', serial: 's3' }); // не переносится
    const result = db.config.liquidateOrg(orgA.id, orgB.id);
    expect(result.transferred).toBe(2);
    const assets = db._getAssets();
    const active = assets.filter(a => a.org_id === orgB.id);
    expect(active.length).toBe(2);
    // Списанный остался на orgA
    const written = assets.find(a => a.serial === 's3');
    expect(written.org_id).toBe(orgA.id);
  });

  test('liquidateOrg — ставит статус liquidated', () => {
    db.config.liquidateOrg(orgA.id, orgB.id);
    const updated = db.config.getOrg(orgA.id);
    expect(updated.status).toBe('liquidated');
    expect(updated.liquidated_at).toBeTruthy();
  });

  test('liquidateOrg — пишет историю по каждому ассету', () => {
    db._addAsset({ org_id: orgA.id, status: 'используется', model: 'X', type: 'T', serial: 'S' });
    db._addAsset({ org_id: orgA.id, status: 'используется', model: 'Y', type: 'T', serial: 'S2' });
    db.config.liquidateOrg(orgA.id, orgB.id);
    const hist = db._getHistory().filter(h => h.action_type === 'org_transfer');
    expect(hist.length).toBe(2);
  });

  test('liquidateOrg renumberInv — перевыпускает инв. номера', () => {
    db._addAsset({ org_id: orgA.id, status: 'используется', inv: 'ALF-NB-00001', model: 'X', type: 'Ноутбук', serial: 'S1' });
    db._addAsset({ org_id: orgA.id, status: 'используется', inv: 'ALF-NB-00002', model: 'Y', type: 'Ноутбук', serial: 'S2' });
    const result = db.config.liquidateOrg(orgA.id, orgB.id, 'system', true);
    expect(result.renumbered).toBe(2);
    const assets = db._getAssets().filter(a => a.org_id === orgB.id);
    expect(assets.every(a => a.inv.startsWith('BET-'))).toBe(true);
    expect(assets.some(a => a.inv_prev === 'ALF-NB-00001')).toBe(true);
    expect(assets.some(a => a.inv_prev === 'ALF-NB-00002')).toBe(true);
  });

  test('liquidateOrg — бросает если org и target совпадают', () => {
    expect(() => db.config.liquidateOrg(orgA.id, orgA.id))
      .toThrow(/совпадает/);
  });

  test('liquidateOrg — бросает для несуществующей целевой org', () => {
    expect(() => db.config.liquidateOrg(orgA.id, 'fake-id'))
      .toThrow(/не найдена/);
  });

  test('liquidateOrg — запрещает ликвидировать системную запись', () => {
    expect(() => db.config.liquidateOrg('sys-org-unk', orgB.id))
      .toThrow(/системную/);
  });
});
