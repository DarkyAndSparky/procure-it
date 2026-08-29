'use strict';
/**
 * Тесты: csv.repo.js::importHistory — разбор составных строк "оборудование"
 * на отдельные позиции с авто-сопоставлением по серийному номеру.
 *
 * Реальные исходные данные (выгрузка из старой Excel-таблицы) показывают,
 * что одна строка истории часто описывает НЕСКОЛЬКО предметов через запятую,
 * с непоследовательным форматированием серийника внутри каждого — отсюда
 * и разнообразие сценариев ниже (взято из реального файла, не выдумано).
 */
const makeDb = require('./helpers/makeDb');

describe('csv.repo.js — importHistory (авто-сопоставление по serial)', () => {
  let db, csvRepo;

  beforeEach(() => {
    db = makeDb();
    csvRepo = jest.requireActual('../server/repositories/csv.repo');
  });

  test('одна позиция, серийник после метки SN — находит существующий актив', () => {
    const asset = db._addAsset({ model: 'HUAWEI MCLF-X', type: 'Ноутбук', serial: '28UBB24309801591' });

    const res = csvRepo.importHistory([
      { date: '2026-04-15', from_who: 'Иванов', to_who: 'Петров',
        equipment: 'Ноутбук HUAWEI MCLF-X, SN 28UBB24309801591', reason: 'Увольнение' },
    ], 'admin');

    expect(res.added).toBe(2); // "Ноутбук HUAWEI MCLF-X" (без serial) + "SN 28UBB..." (с serial)
    expect(res.matched).toBe(1);

    const hist = db._getHistory();
    const linked = hist.find(h => h.asset_id === asset.id);
    expect(linked).toBeTruthy();
    expect(linked.serial).toBe('28UBB24309801591');
    expect(linked.model).toBe('HUAWEI MCLF-X'); // подтянуто из реального актива, не из текста
  });

  test('несколько позиций в одной строке — разбиваются на отдельные записи истории', () => {
    const laptop = db._addAsset({ model: 'ASUS VIVA BOOK M1605N', type: 'Ноутбук', serial: 'TBN0CV17R731486' });
    const monitor = db._addAsset({ model: 'DIGMA 27P501F', type: 'Монитор', serial: 'D1V410NAE00244' });

    const res = csvRepo.importHistory([
      { date: '2026-04-20', from_who: 'А', to_who: 'Б',
        equipment: 'Ноутбук ASUS VIVA BOOK M1605N SN TBN0CV17R731486, Монитор DIGMA 27P501F SN D1V410NAE00244',
        reason: 'Трудоустройство' },
    ], 'admin');

    expect(res.added).toBe(2);
    expect(res.matched).toBe(2);

    const hist = db._getHistory();
    expect(hist.some(h => h.asset_id === laptop.id)).toBe(true);
    expect(hist.some(h => h.asset_id === monitor.id)).toBe(true);
  });

  test('серийник без метки SN, таб-разделённый формат — находит актив', () => {
    const monitor = db._addAsset({ model: 'XIAOMI P27FBB-RGGL', type: 'Монитор', serial: '52756/126100019259' });

    const res = csvRepo.importHistory([
      { date: '2026-04-10', from_who: 'В', to_who: 'Г',
        equipment: 'Ноутбук  HUAWEI MCLF-X 28UBB24622801962, Монитор\tXIAOMI P27FBB-RGGL\t52756/126100019259',
        reason: 'Увольнение' },
    ], 'admin');

    expect(res.matched).toBe(1);
    const hist = db._getHistory();
    expect(hist.some(h => h.asset_id === monitor.id)).toBe(true);
  });

  test('позиции без серийника (аксессуары) — не привязываются к активу, но всё равно сохраняются', () => {
    const res = csvRepo.importHistory([
      { date: '2026-05-01', from_who: 'Д', to_who: 'Е',
        equipment: 'Гарнитура A4TECH HU-8, Web камера Oclick OK-C001FH, Кронштейн Buro M8',
        reason: 'Выдача' },
    ], 'admin');

    expect(res.added).toBe(3);
    expect(res.matched).toBe(0);
    const hist = db._getHistory();
    const rows = hist.filter(h => h.reason === 'Выдача');
    expect(rows.length).toBe(3);
    rows.forEach(r => expect(r.asset_id).toBe(''));
  });

  test('не путает модель с серийником (ложное совпадение исключено)', () => {
    // "A4TECH HU-8" содержит цифру и не должно быть принято за серийник —
    // даже если бы актив с таким же "serial" существовал (маловероятно,
    // но проверяем явно, что модель никогда не уходит в SN_LABEL_RE как
    // кандидат без явной метки).
    const res = csvRepo.importHistory([
      { date: '2026-05-02', from_who: 'Ж', to_who: 'З',
        equipment: 'Гарнитура A4TECH HU-8', reason: 'Выдача' },
    ], 'admin');
    const hist = db._getHistory();
    const row = hist.find(h => h.reason === 'Выдача' && h.from_who === 'Ж');
    expect(row.serial).toBe('');
    expect(row.asset_id).toBe('');
  });

  test('серийник не найден в базе — запись сохраняется без привязки (не падает)', () => {
    const res = csvRepo.importHistory([
      { date: '2026-05-03', from_who: 'И', to_who: 'К',
        equipment: 'Системный блок IRU  SN: HAB2306101432', reason: 'Перемещение' },
    ], 'admin');
    expect(res.added).toBe(1);
    expect(res.matched).toBe(0);
    const hist = db._getHistory();
    const row = hist.find(h => h.from_who === 'И');
    expect(row.asset_id).toBe('');
    expect(row.serial).toBe('HAB2306101432'); // серийник сохранён в тексте, даже без привязки
  });

  test('дедупликация — повторный импорт той же позиции не создаёт дубль', () => {
    const asset = db._addAsset({ model: 'DIGMA', type: 'Монитор', serial: 'SN00012345' });
    const rows = [{ date: '2026-05-04', from_who: 'Л', to_who: 'М',
      equipment: 'Монитор DIGMA SN SN00012345', reason: 'Перемещение' }];

    const first = csvRepo.importHistory(rows, 'admin');
    expect(first.added).toBe(1);

    const second = csvRepo.importHistory(rows, 'admin');
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
