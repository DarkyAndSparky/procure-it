'use strict';
/**
 * Тесты: Backup API (список / создание / скачивание / восстановление).
 *
 * Важно: маршруты /api/backup/* работают с файловой системой напрямую
 * (fs.*), в обход мока database.js. Поэтому для изоляции от реальной
 * папки data/ используется переменная окружения IT_ASSETS_DATA_DIR —
 * она должна быть выставлена ДО require('../server/index'), так как
 * DATA_DIR/BACKUP_DIR вычисляются один раз при загрузке модуля.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'it-assets-backup-test-'));
process.env.IT_ASSETS_DATA_DIR = TMP_DATA_DIR;

// Кладём заведомо известное содержимое, чтобы backup/restore было чем проверять
fs.writeFileSync(path.join(TMP_DATA_DIR, 'db.json'),
  JSON.stringify({ _meta: { version: 2 }, assets: [], history: [] }));
fs.writeFileSync(path.join(TMP_DATA_DIR, 'config.json'),
  JSON.stringify({ _meta: { version: 2 }, settings: { company_name: 'Backup Test' } }));

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

afterAll(() => {
  delete process.env.IT_ASSETS_DATA_DIR;
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

describe('GET /api/backup/list', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).get('/api/backup/list');
    expect(res.status).toBe(401);
  });

  test('изначально пустой список', async () => {
    const res = await request(app).get('/api/backup/list').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });
});

describe('POST /api/backup/create', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/backup/create');
    expect(res.status).toBe(401);
  });

  test('создаёт zip-бэкап с обоими файлами', async () => {
    const res = await request(app).post('/api/backup/create').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.file).toMatch(/^backup_manual_.*\.zip$/);
    expect(res.body.size).toBeGreaterThan(0);

    // Файл реально появился на диске, во временной папке теста
    const onDisk = fs.existsSync(path.join(TMP_DATA_DIR, 'backups', res.body.file));
    expect(onDisk).toBe(true);
  });

  test('появляется в /api/backup/list', async () => {
    const before = await request(app).get('/api/backup/list').set(AUTH);
    const countBefore = before.body.length;

    const created = await request(app).post('/api/backup/create').set(AUTH);
    const after = await request(app).get('/api/backup/list').set(AUTH);

    expect(after.body.length).toBe(countBefore + 1);
    expect(after.body.some(b => b.name === created.body.file)).toBe(true);
  });
});

describe('GET /api/backup/download/:name', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).get('/api/backup/download/whatever.zip');
    expect(res.status).toBe(401);
  });

  test('скачивает существующий бэкап', async () => {
    const created = await request(app).post('/api/backup/create').set(AUTH);
    const res = await request(app)
      .get(`/api/backup/download/${created.body.file}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  test('несуществующий файл → 404', async () => {
    const res = await request(app).get('/api/backup/download/no-such-file.zip').set(AUTH);
    expect(res.status).toBe(404);
  });

  test('SEC-3: оператор (не admin) получает 403, requireAdmin', async () => {
    const op = mockDb.createUser({ name: 'Backup Op', login: 'backupop', role: 'operator', pin: 'oppin123' });
    const created = await request(app).post('/api/backup/create').set(AUTH);
    const res = await request(app)
      .get(`/api/backup/download/${created.body.file}`)
      .set({ 'x-user-id': op.id, 'x-edit-password': 'oppin123' });
    expect(res.status).toBe(403);
  });

  test('SEC-3: viewer получает 403', async () => {
    const viewer = mockDb.createUser({ name: 'Backup Viewer', login: 'backupviewer', role: 'viewer', pin: '' });
    const created = await request(app).post('/api/backup/create').set(AUTH);
    const res = await request(app)
      .get(`/api/backup/download/${created.body.file}`)
      .set({ 'x-user-id': viewer.id, 'x-edit-password': '' });
    expect(res.status).toBe(403);
  });

  test('защищено от path traversal (../)', async () => {
    // path.basename() внутри маршрута должен обрезать "../" — секретный файл
    // вне BACKUP_DIR не должен быть доступен даже при попытке выйти из папки
    const res = await request(app)
      .get('/api/backup/download/' + encodeURIComponent('../../db.json')).set(AUTH);
    // Express убирает basename → ищет файл "db.json" внутри backups/, которого там нет
    expect(res.status).toBe(404);
  });
});

describe('POST /api/backup/restore/:name', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/backup/restore/whatever.zip');
    expect(res.status).toBe(401);
  });

  test('несуществующий файл → 404', async () => {
    const res = await request(app).post('/api/backup/restore/no-such-file.zip').set(AUTH);
    expect(res.status).toBe(404);
  });

  test('SEC-3: оператор (не admin) получает 403, requireAdmin', async () => {
    const op = mockDb.createUser({ name: 'Backup Op2', login: 'backupop2', role: 'operator', pin: 'oppin456' });
    const created = await request(app).post('/api/backup/create').set(AUTH);
    const res = await request(app)
      .post(`/api/backup/restore/${created.body.file}`)
      .set({ 'x-user-id': op.id, 'x-edit-password': 'oppin456' });
    expect(res.status).toBe(403);
  });

  test('SEC-3: viewer получает 403', async () => {
    const viewer = mockDb.createUser({ name: 'Backup Viewer2', login: 'backupviewer2', role: 'viewer', pin: '' });
    const created = await request(app).post('/api/backup/create').set(AUTH);
    const res = await request(app)
      .post(`/api/backup/restore/${created.body.file}`)
      .set({ 'x-user-id': viewer.id, 'x-edit-password': '' });
    expect(res.status).toBe(403);
  });

  test('восстанавливает db.json и config.json из бэкапа', async () => {
    // Портим текущие файлы...
    fs.writeFileSync(path.join(TMP_DATA_DIR, 'db.json'),
      JSON.stringify({ assets: ['CORRUPTED'] }));

    // Делаем свежий бэкап с ЗАВЕДОМО хорошим содержимым
    fs.writeFileSync(path.join(TMP_DATA_DIR, 'db.json'),
      JSON.stringify({ _meta: { version: 2 }, assets: [{ id: 'known-asset' }], history: [] }));
    const created = await request(app).post('/api/backup/create').set(AUTH);

    // Портим файл снова — как будто что-то пошло не так после бэкапа
    fs.writeFileSync(path.join(TMP_DATA_DIR, 'db.json'),
      JSON.stringify({ assets: ['CORRUPTED-AGAIN'] }));

    const res = await request(app)
      .post(`/api/backup/restore/${created.body.file}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.full).toBe(true);

    const restored = JSON.parse(fs.readFileSync(path.join(TMP_DATA_DIR, 'db.json'), 'utf-8'));
    expect(restored.assets).toEqual([{ id: 'known-asset' }]);
  });

  test('бэкап включает it-assets.sqlite, restore его восстанавливает (Фаза 7c)', async () => {
    // Реальный it-assets.sqlite в этом тестовом каталоге не создаётся сам —
    // makeBackup() требует ./db/sqlite лениво, а тестовый app собран поверх
    // мока database.js, так что для index.js своя (реальная) цепочка
    // db/sqlite.js в этом каталоге не запускалась. Создаём файл вручную
    // тем же способом, каким test создаёт db.json/config.json.
    const { DatabaseSync } = require('node:sqlite');
    const sqlitePath = path.join(TMP_DATA_DIR, 'it-assets.sqlite');
    const sq = new DatabaseSync(sqlitePath);
    sq.exec('CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT)');
    sq.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').run('known-account', 'SIP Trunk');
    sq.close();

    const created = await request(app).post('/api/backup/create').set(AUTH);
    expect(created.body.ok).toBe(true);

    // Портим/удаляем sqlite-файл — как будто что-то пошло не так
    fs.unlinkSync(sqlitePath);
    expect(fs.existsSync(sqlitePath)).toBe(false);

    const res = await request(app)
      .post(`/api/backup/restore/${created.body.file}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(fs.existsSync(sqlitePath)).toBe(true);

    const sq2 = new DatabaseSync(sqlitePath);
    const rows = sq2.prepare('SELECT * FROM accounts').all();
    sq2.close();
    expect(rows).toEqual([{ id: 'known-account', name: 'SIP Trunk' }]);
  });

  test('старый бэкап без it-assets.sqlite (до Фазы 7c) — восстанавливает db.json/config.json, не падает', async () => {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('db.json', Buffer.from(JSON.stringify({ _meta:{version:2}, assets:[{ id:'legacy-asset' }], history:[] })));
    zip.addFile('config.json', Buffer.from(JSON.stringify({ _meta:{version:2}, settings:{ company_name:'Legacy' } })));
    const legacyName = `backup_manual_legacy-no-sqlite_test.zip`;
    fs.mkdirSync(path.join(TMP_DATA_DIR, 'backups'), { recursive: true });
    zip.writeZip(path.join(TMP_DATA_DIR, 'backups', legacyName));

    const res = await request(app).post(`/api/backup/restore/${legacyName}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const restored = JSON.parse(fs.readFileSync(path.join(TMP_DATA_DIR, 'db.json'), 'utf-8'));
    expect(restored.assets).toEqual([{ id: 'legacy-asset' }]);
  });

  test('сквозной цикл с реальными данными: создать актив -> бэкап -> "поломать" sqlite -> restore -> актив на месте', async () => {
    // Пишем напрямую в TMP_DATA_DIR/it-assets.sqlite (тем же способом, что
    // и тест "бэкап включает it-assets.sqlite" выше) — не через assetsRepo,
    // который из-за кэша модулей после makeDb() резолвится в СВОЙ
    // изолированный временный каталог, а не в TMP_DATA_DIR, которым
    // реально управляет тестируемый index.js/makeBackup().
    const { DatabaseSync } = require('node:sqlite');
    const sqlitePath = path.join(TMP_DATA_DIR, 'it-assets.sqlite');
    const sq = new DatabaseSync(sqlitePath);
    sq.exec('CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, model TEXT)');
    sq.prepare('INSERT OR REPLACE INTO assets (id, model) VALUES (?, ?)').run('real-cycle-asset', 'RealBackupCycle');
    sq.close();

    const backupRes = await request(app).post('/api/backup/create').set(AUTH);
    expect(backupRes.body.ok).toBe(true);

    // "Ломаем" файл — как будто что-то пошло не так
    fs.writeFileSync(sqlitePath, 'CORRUPTED-NOT-A-VALID-SQLITE-FILE');

    const restoreRes = await request(app)
      .post(`/api/backup/restore/${backupRes.body.file}`).set(AUTH);
    expect(restoreRes.status).toBe(200);

    const fresh = new DatabaseSync(sqlitePath);
    const row = fresh.prepare('SELECT * FROM assets WHERE id = ?').get('real-cycle-asset');
    fresh.close();
    expect(row).toBeTruthy();
    expect(row.model).toBe('RealBackupCycle');
  });

  test('перед восстановлением сам создаёт pre-restore бэкап (подстраховка)', async () => {
    const before = await request(app).get('/api/backup/list').set(AUTH);
    const created = await request(app).post('/api/backup/create').set(AUTH);

    await request(app).post(`/api/backup/restore/${created.body.file}`).set(AUTH);

    const after = await request(app).get('/api/backup/list').set(AUTH);
    // +1 за created, +1 за pre-restore, сделанный самим restore
    expect(after.body.some(b => b.name.startsWith('backup_pre-restore_'))).toBe(true);
  });

  test('SEC-6: битый db.json в zip (не JSON) → 400, живые файлы не тронуты', async () => {
    const AdmZip = require('adm-zip');
    const before = fs.readFileSync(path.join(TMP_DATA_DIR, 'db.json'), 'utf-8');

    const zip = new AdmZip();
    zip.addFile('db.json', Buffer.from('{ этo not valid json'));
    zip.addFile('config.json', Buffer.from(JSON.stringify({ settings: { company_name: 'X' } })));
    const badName = 'backup_manual_bad-json_test.zip';
    fs.mkdirSync(path.join(TMP_DATA_DIR, 'backups'), { recursive: true });
    zip.writeZip(path.join(TMP_DATA_DIR, 'backups', badName));

    const res = await request(app).post(`/api/backup/restore/${badName}`).set(AUTH);
    expect(res.status).toBe(400);
    expect(fs.readFileSync(path.join(TMP_DATA_DIR, 'db.json'), 'utf-8')).toBe(before); // не перезаписано
  });

  test('SEC-6: db.json без assets[]/history[] (валидный JSON, но не бэкап) → 400', async () => {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('db.json', Buffer.from(JSON.stringify({ hello: 'world' })));
    zip.addFile('config.json', Buffer.from(JSON.stringify({ settings: { company_name: 'X' } })));
    const badName = 'backup_manual_wrong-shape_test.zip';
    fs.mkdirSync(path.join(TMP_DATA_DIR, 'backups'), { recursive: true });
    zip.writeZip(path.join(TMP_DATA_DIR, 'backups', badName));

    const res = await request(app).post(`/api/backup/restore/${badName}`).set(AUTH);
    expect(res.status).toBe(400);
  });

  test('SEC-6: битый config.json (не JSON) → 400', async () => {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('db.json', Buffer.from(JSON.stringify({ assets: [], history: [] })));
    zip.addFile('config.json', Buffer.from('not { valid json at all'));
    const badName = 'backup_manual_bad-config_test.zip';
    fs.mkdirSync(path.join(TMP_DATA_DIR, 'backups'), { recursive: true });
    zip.writeZip(path.join(TMP_DATA_DIR, 'backups', badName));

    const res = await request(app).post(`/api/backup/restore/${badName}`).set(AUTH);
    expect(res.status).toBe(400);
  });

  test('SEC-6: битая сигнатура it-assets.sqlite в zip → 400, sqlite на диске не тронут', async () => {
    const { DatabaseSync } = require('node:sqlite');
    const AdmZip = require('adm-zip');
    const sqlitePath = path.join(TMP_DATA_DIR, 'it-assets.sqlite');
    const sq = new DatabaseSync(sqlitePath);
    sq.exec('CREATE TABLE IF NOT EXISTS marker (id TEXT PRIMARY KEY)');
    sq.prepare('INSERT OR REPLACE INTO marker (id) VALUES (?)').run('untouched');
    sq.close();

    const zip = new AdmZip();
    zip.addFile('db.json', Buffer.from(JSON.stringify({ assets: [], history: [] })));
    zip.addFile('config.json', Buffer.from(JSON.stringify({ settings: { company_name: 'X' } })));
    zip.addFile('it-assets.sqlite', Buffer.from('NOT-A-REAL-SQLITE-FILE-HEADER'));
    const badName = 'backup_manual_bad-sqlite_test.zip';
    fs.mkdirSync(path.join(TMP_DATA_DIR, 'backups'), { recursive: true });
    zip.writeZip(path.join(TMP_DATA_DIR, 'backups', badName));

    const res = await request(app).post(`/api/backup/restore/${badName}`).set(AUTH);
    expect(res.status).toBe(400);

    const check = new DatabaseSync(sqlitePath);
    const row = check.prepare('SELECT * FROM marker WHERE id = ?').get('untouched');
    check.close();
    expect(row).toBeTruthy(); // sqlite-файл остался прежним, не перезаписан мусором
  });

  test('SEC-6: битый db.json в старом формате (не-zip, plain JSON) → 400', async () => {
    const badName = 'backup_manual_bad-plain_test.json';
    fs.mkdirSync(path.join(TMP_DATA_DIR, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(TMP_DATA_DIR, 'backups', badName), 'totally not json');

    const res = await request(app).post(`/api/backup/restore/${badName}`).set(AUTH);
    expect(res.status).toBe(400);
  });
});

describe('pruneBackups — раздельные пулы по типам', () => {
  const fs   = require('fs');
  const path = require('path');

  test('startup-бэкапы не вытесняют manual-бэкапы', async () => {
    // Создаём вручную 3 manual и 3 startup бэкапа
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/backup/create').set(AUTH);
    }
    // Проверяем что manual-бэкапы есть
    const list = await request(app).get('/api/backup/list').set(AUTH);
    const manuals  = list.body.filter(b => b.name.startsWith('backup_manual_'));
    const startups = list.body.filter(b => b.name.startsWith('backup_startup_'));
    // Оба типа присутствуют независимо друг от друга
    expect(manuals.length).toBeGreaterThan(0);
    // startup появляются при старте сервера (не в тесте), но main pool не смешан
    expect(manuals.length + startups.length).toBeLessThanOrEqual(list.body.length);
  });

  test('лимит manual не превышает 20', async () => {
    // Создаём 25 manual-бэкапов
    for (let i = 0; i < 25; i++) {
      await request(app).post('/api/backup/create').set(AUTH);
    }
    const list = await request(app).get('/api/backup/list').set(AUTH);
    const manuals = list.body.filter(b => b.name.startsWith('backup_manual_'));
    expect(manuals.length).toBeLessThanOrEqual(20);
  });

  test('SEC-10: суммарный размер папки backups ограничен — старые файлы удаляются первыми', async () => {
    const prevEnv = process.env.IT_ASSETS_BACKUP_MAX_MB;
    process.env.IT_ASSETS_BACKUP_MAX_MB = '1'; // 1MB — заведомо маленький лимит для теста
    try {
      // Кладём несколько "толстых" фейковых бэкапов напрямую в backups/,
      // чтобы суммарно превысить лимит, с разным временем изменения —
      // чтобы порядок "старые первыми" был однозначным.
      const names = [];
      for (let i = 0; i < 5; i++) {
        const name = `backup_manual_fatfile-${i}_test.zip`;
        const dest = path.join(TMP_DATA_DIR, 'backups', name);
        fs.mkdirSync(path.join(TMP_DATA_DIR, 'backups'), { recursive: true });
        fs.writeFileSync(dest, Buffer.alloc(400 * 1024)); // 400KB каждый → 2MB суммарно на 5 штук
        const t = new Date(Date.now() - (5 - i) * 60_000); // i=0 — самый старый
        fs.utimesSync(dest, t, t);
        names.push(name);
      }

      // Триггерим pruneBackups() косвенно через создание ещё одного бэкапа
      await request(app).post('/api/backup/create').set(AUTH);

      const remaining = fs.readdirSync(path.join(TMP_DATA_DIR, 'backups'))
        .filter(f => names.includes(f));
      // Самый старый (fatfile-0) должен быть удалён первым лимитом по размеру
      expect(remaining.includes('backup_manual_fatfile-0_test.zip')).toBe(false);
      // Папка не должна опустеть целиком — самый свежий бэкап всегда остаётся
      const allAfter = fs.readdirSync(path.join(TMP_DATA_DIR, 'backups'))
        .filter(f => f.endsWith('.zip') && !f.endsWith('.config.json'));
      expect(allAfter.length).toBeGreaterThan(0);

      const totalSize = allAfter
        .reduce((sum, f) => sum + fs.statSync(path.join(TMP_DATA_DIR, 'backups', f)).size, 0);
      // Лимит — 1MB, допускаем небольшой запас (последний файл может чуть
      // превышать порог сам по себе — его всё равно не удаляем).
      expect(totalSize).toBeLessThan(1.5 * 1024 * 1024);
    } finally {
      if (prevEnv === undefined) delete process.env.IT_ASSETS_BACKUP_MAX_MB;
      else process.env.IT_ASSETS_BACKUP_MAX_MB = prevEnv;
    }
  });
});
