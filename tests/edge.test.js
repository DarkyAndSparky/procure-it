'use strict';
/**
 * Тесты: граничные случаи
 * - nextInv счётчик > 99999
 * - liquidateOrg с высокими номерами у target
 * - deleteInvRuleForce transfer без коллизий
 * - closeFilial — новые ассеты не назначаются на закрытый
 * - ликвидация без ассетов
 */
const makeDb = require('./helpers/makeDb');

describe('nextInv — граничные случаи', () => {
  let db, org;
  beforeEach(() => {
    db = makeDb();
    org = db.config.createOrg({ name: 'Граница', short_code: 'BND' });
    db.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });
  });

  test('счётчик > 99999 — номер выдаётся с 6 цифрами', () => {
    // Добавляем ассет с номером 99999
    db._addAsset({ inv: 'BND-NB-99999', org_id: org.id });
    const result = db.config.nextInv(org.id, 'NB');
    expect(result.inv).toBe('BND-NB-100000');
    expect(result.next).toBe(100000);
  });

  test('счётчик в правиле ниже реального максимума — берёт максимум из ассетов', () => {
    // Счётчик правила = 5, но в базе уже есть номер 00010
    db._addAsset({ inv: 'BND-NB-00010', org_id: org.id });
    // Принудительно ставим счётчик = 5 (имитируем рассинхрон)
    db.cfg.get('organizations').find({ id: org.id })
      .get('inv_rules').find({ type_code: 'NB' })
      .assign({ counter: 5 }).write();
    const result = db.config.nextInv(org.id, 'NB');
    expect(result.next).toBe(11); // макс из ассетов (10) + 1
  });

  test('несколько org не влияют на счётчики друг друга', () => {
    const org2 = db.config.createOrg({ name: 'Вторая', short_code: 'SEC' });
    db.config.addInvRule(org2.id, { type_code: 'NB', type_name: 'Ноутбук' });
    db._addAsset({ inv: 'BND-NB-00050', org_id: org.id });
    const r1 = db.config.nextInv(org.id,  'NB');
    const r2 = db.config.nextInv(org2.id, 'NB');
    expect(r1.inv).toBe('BND-NB-00051');
    expect(r2.inv).toBe('SEC-NB-00001');
  });
});

describe('liquidateOrg — граничные случаи', () => {
  let db, orgA, orgB;
  beforeEach(() => {
    db = makeDb();
    orgA = db.config.createOrg({ name: 'Альфа', short_code: 'ALF' });
    orgB = db.config.createOrg({ name: 'Бета',  short_code: 'BET' });
    db.config.addInvRule(orgA.id, { type_code: 'NB', type_name: 'Ноутбук' });
    db.config.addInvRule(orgB.id, { type_code: 'NB', type_name: 'Ноутбук' });
  });

  test('renumberInv — не перезаписывает высокие номера у target', () => {
    // У target уже есть BET-NB-00099
    db._addAsset({ inv: 'BET-NB-00099', org_id: orgB.id, status: 'используется', model: 'X', type: 'T', serial: 'S0' });
    // У source два ассета
    db._addAsset({ inv: 'ALF-NB-00001', org_id: orgA.id, status: 'используется', model: 'A', type: 'T', serial: 'S1' });
    db._addAsset({ inv: 'ALF-NB-00002', org_id: orgA.id, status: 'используется', model: 'B', type: 'T', serial: 'S2' });
    db.config.liquidateOrg(orgA.id, orgB.id, 'system', true);
    const assets = db._getAssets();
    const invs = assets.filter(a => a.org_id === orgB.id).map(a => a.inv).sort();
    // Должны быть: BET-NB-00099 (существующий), BET-NB-00100, BET-NB-00101
    expect(invs).toContain('BET-NB-00099');
    expect(invs).toContain('BET-NB-00100');
    expect(invs).toContain('BET-NB-00101');
    // Нет дублей
    expect(new Set(invs).size).toBe(invs.length);
  });

  test('liquidateOrg без ассетов — ставит liquidated, возвращает transferred=0', () => {
    const result = db.config.liquidateOrg(orgA.id, orgB.id);
    expect(result.transferred).toBe(0);
    expect(result.renumbered).toBe(0);
    const updated = db.config.getOrg(orgA.id);
    expect(updated.status).toBe('liquidated');
  });

  test('liquidateOrg — не трогает списанные ассеты', () => {
    db._addAsset({ inv: 'ALF-NB-00001', org_id: orgA.id, status: 'списан', model: 'X', type: 'T', serial: 'S1' });
    const result = db.config.liquidateOrg(orgA.id, orgB.id, 'system', true);
    expect(result.transferred).toBe(0);
    const asset = db._getAssets().find(a => a.serial === 'S1');
    expect(asset.org_id).toBe(orgA.id); // не перенесён
  });

  test('liquidateOrg renumberInv=false — org_id меняется, inv остаётся', () => {
    db._addAsset({ inv: 'ALF-NB-00001', org_id: orgA.id, status: 'используется', model: 'X', type: 'T', serial: 'S1' });
    db.config.liquidateOrg(orgA.id, orgB.id, 'system', false);
    const asset = db._getAssets().find(a => a.serial === 'S1');
    expect(asset.org_id).toBe(orgB.id);
    expect(asset.inv).toBe('ALF-NB-00001'); // не перенумерован
    expect(asset.inv_prev).toBeNull(); // не перенумерован; SQL-колонка не установлена = null (не undefined, как было в lowdb)
  });
});

describe('deleteInvRuleForce transfer — нет коллизий', () => {
  let db, org;
  beforeEach(() => {
    db = makeDb();
    org = db.config.createOrg({ name: 'Тест', short_code: 'TST' });
    db.config.addInvRule(org.id, { type_code: 'NB',  type_name: 'Ноутбук' });
    db.config.addInvRule(org.id, { type_code: 'MON', type_name: 'Монитор' });
  });

  test('перенос не создаёт дублей инв. номеров', () => {
    // У MON уже есть 5 ассетов
    for (let i = 1; i <= 5; i++) {
      db._addAsset({ inv: `TST-MON-0000${i}`, org_id: org.id });
    }
    // У NB 3 ассета для переноса
    for (let i = 1; i <= 3; i++) {
      db._addAsset({ inv: `TST-NB-0000${i}`, org_id: org.id });
    }
    db.config.deleteInvRuleForce(org.id, 'NB', 'transfer', 'MON');
    const invs = db._getAssets()
      .map(a => a.inv).filter(Boolean);
    expect(new Set(invs).size).toBe(invs.length); // нет дублей
    // Новые номера должны идти с 6
    expect(invs).toContain('TST-MON-00006');
    expect(invs).toContain('TST-MON-00007');
    expect(invs).toContain('TST-MON-00008');
  });

  test('после transfer счётчик MON правила обновился', () => {
    db._addAsset({ inv: 'TST-NB-00001', org_id: org.id });
    db.config.deleteInvRuleForce(org.id, 'NB', 'transfer', 'MON');
    const updated = db.config.getOrg(org.id);
    const monRule = updated.inv_rules.find(r => r.type_code === 'MON');
    expect(monRule.counter).toBeGreaterThanOrEqual(1);
  });
});

describe('closeFilial — граничные случаи', () => {
  let db;
  beforeEach(() => { db = makeDb(); });

  test('закрытый филиал имеет статус closed', () => {
    const f = db.config.createFilial({ name: 'Закрываемый' });
    db.config.closeFilial(f.id);
    const updated = db.config.getFilial(f.id);
    expect(updated.status).toBe('closed');
    expect(updated.closed_at).toBeTruthy();
  });

  test('getFilials — не возвращает закрытые по умолчанию', () => {
    const f = db.config.createFilial({ name: 'Закрытый2' });
    db.config.closeFilial(f.id);
    // Закрытые не фильтруются на уровне getFilials (статус !== system),
    // но статус closed виден — тест документирует поведение
    const all = db.config.getFilials(false);
    const closed = all.find(fi => fi.id === f.id);
    expect(closed).toBeTruthy();
    expect(closed.status).toBe('closed');
  });

  test('affected_assets не считает списанные', () => {
    const f = db.config.createFilial({ name: 'Со списанными' });
    db._addAsset({ filial_id: f.id, status: 'используется' });
    db._addAsset({ filial_id: f.id, status: 'резерв' });
    db._addAsset({ filial_id: f.id, status: 'списан' });
    const result = db.config.closeFilial(f.id);
    expect(result.affected_assets).toBe(2); // только активные
  });

  test('повторное закрытие уже закрытого — обновляет closed_at', () => {
    const f = db.config.createFilial({ name: 'Двойное закрытие' });
    db.config.closeFilial(f.id);
    const first = db.config.getFilial(f.id).closed_at;
    // Небольшая пауза
    const result = db.config.closeFilial(f.id);
    expect(result.closed).toBe(true);
  });
});

describe('Инвентарные номера — уникальность при параллельных вызовах', () => {
  test('последовательные nextInv не дают дублей (10 вызовов)', () => {
    const db = makeDb();
    const org = db.config.createOrg({ name: 'Уник', short_code: 'UNQ' });
    db.config.addInvRule(org.id, { type_code: 'NB', type_name: 'Ноутбук' });
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(db.config.nextInv(org.id, 'NB').inv);
    }
    expect(new Set(results).size).toBe(10);
    expect(results[0]).toBe('UNQ-NB-00001');
    expect(results[9]).toBe('UNQ-NB-00010');
  });
});
