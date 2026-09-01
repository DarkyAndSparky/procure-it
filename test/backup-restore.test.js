// Регрессионные тесты на POST /api/restore — конкретно на транзакционность,
// добавленную при аудите перед слиянием dev→main. До этого фикса: DELETE
// выполнялся раньше проверки, что новые данные вообще вставятся — при
// несовместимом бэкапе таблица users могла остаться пустой (полная
// блокировка входа), а ответ API отдавал размер входного массива вместо
// числа реально вставленных строк. Это ровно тот код, который проверяют
// один раз при аварии — стоит того, чтобы иметь на него тесты, а не
// полагаться только на ручную проверку curl'ом.
//
// Изоляция от реальной БД — тот же приём, что в auth.test.js: чистая
// in-memory sql.js через runMigrations(), подмена db/connection.js в
// require.cache. Проверяем реальный HTTP-путь (express.json() + настоящий
// authMiddleware/adminOnly), а не вызываем внутреннюю функцию напрямую —
// он тоже часть контракта (сессия, роль, заголовок x-auth-token).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const initSqlJs = require('sql.js');
const { runMigrations } = require('../src/db/schema');

async function setup() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db); // сеет default admin — не мешает, ниже заводим своего

  const connectionPath = require.resolve('../src/db/connection');
  require.cache[connectionPath] = {
    id: connectionPath, filename: connectionPath, loaded: true,
    exports: {
      getDb: () => db,
      saveDb: () => {},
      query: (sql, params) => {
        const res = db.exec(sql, params);
        if (!res.length) return [];
        const cols = res[0].columns;
        return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
      },
      run: (sql, params) => { try { db.run(sql, params); return true; } catch(e) { return false; } },
      rowToRequest: (row) => row, // не нужен для этих тестов
    },
  };

  ['../src/routes/backup', '../src/auth/sessions', '../src/auth/middleware'].forEach(p => {
    delete require.cache[require.resolve(p)];
  });
  const { sessionCreate } = require('../src/auth/sessions');
  const backupRouterFactory = require('../src/routes/backup');

  // Свой admin-пользователь напрямую в БД — без прогона хеширования пароля,
  // для этих тестов важна только роль, не сама аутентификация.
  db.run('DELETE FROM users');
  db.run("INSERT INTO users (id,username,password,salt,role,must_change_password) VALUES (1,'testadmin','x','y','admin',0)");
  const token = 'test-admin-token';
  sessionCreate(token, 1);

  const app = express();
  app.use(express.json());
  const noopLimiter = (req, res, next) => next();
  app.use('/api', backupRouterFactory(noopLimiter));

  const server = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  async function restore(body) {
    const resp = await fetch(`http://127.0.0.1:${port}/api/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
      body: JSON.stringify(body),
    });
    return { status: resp.status, json: await resp.json() };
  }

  return { db, restore, port, close: () => server.close() };
}

test('restore с полностью невалидным users не обнуляет таблицу пользователей', async () => {
  const { db, restore, close } = await setup();
  try {
    const before = db.exec('SELECT COUNT(*) FROM users')[0].values[0][0];
    assert.equal(before, 1, 'до restore должен быть ровно наш testadmin');

    const { status, json } = await restore({
      users: [
        { username: 'hacker1', role: 'admin' }, // без password — не пройдёт валидацию
        { username: 'hacker2', role: 'admin' },
      ],
    });

    assert.equal(status, 200);
    assert.equal(json.restored.users, 0, 'ни одна запись не должна засчитаться восстановленной');

    const after = db.exec('SELECT COUNT(*) FROM users')[0].values[0][0];
    assert.equal(after, 1, 'таблица users не должна быть тронута при полностью невалидном списке');
    const username = db.exec('SELECT username FROM users')[0].values[0][0];
    assert.equal(username, 'testadmin', 'исходный админ должен остаться');
  } finally { close(); }
});

test('restore с валидными users заменяет таблицу целиком', async () => {
  const { db, restore, close } = await setup();
  try {
    const { status, json } = await restore({
      users: [
        { username: 'newadmin', password: 'hashedpw', salt: 'somesalt', role: 'admin' },
        { username: 'newop', password: 'hashedpw2', salt: 'somesalt2', role: 'operator' },
      ],
    });
    assert.equal(status, 200);
    assert.equal(json.restored.users, 2);

    const rows = db.exec('SELECT username, role FROM users ORDER BY username')[0].values;
    assert.deepEqual(rows, [['newadmin', 'admin'], ['newop', 'operator']]);
  } finally { close(); }
});

test('restore пропускает организацию без full/short, не роняя остальные', async () => {
  const { db, restore, close } = await setup();
  try {
    const { status, json } = await restore({
      orgs: [
        { id: 'org-1', full: 'ООО Ромашка', short: 'Ромашка' },
        { id: 'org-2', short: 'БезПолногоНазвания' }, // нет full — должна быть пропущена
        { id: 'org-3', full: 'ООО Лютик', short: 'Лютик' },
      ],
    });
    assert.equal(status, 200);
    assert.equal(json.restored.orgs, 2, 'должны учесться только 2 валидные организации');

    const shorts = db.exec('SELECT short FROM orgs ORDER BY short')[0].values.map(r => r[0]);
    assert.deepEqual(shorts, ['Лютик', 'Ромашка']);
  } finally { close(); }
});

test('restore организации без prefix не падает (регрессия конкретного бага)', async () => {
  const { db, restore, close } = await setup();
  try {
    // Баг, найденный при этом же аудите: o.prefix без ||'' фолбэка ронял
    // INSERT на undefined в SQL-параметре. Проверяем, что вставка проходит,
    // когда prefix в присланных данных вообще отсутствует.
    const { status, json } = await restore({
      orgs: [{ id: 'org-1', full: 'ООО Ромашка', short: 'Ромашка' }],
    });
    assert.equal(status, 200);
    assert.equal(json.restored.orgs, 1);
    const prefix = db.exec("SELECT prefix FROM orgs WHERE short='Ромашка'")[0].values[0][0];
    assert.equal(prefix, '');
  } finally { close(); }
});

test('restore пропускает заявку без name', async () => {
  const { db, restore, close } = await setup();
  try {
    const { status, json } = await restore({
      requests: [
        { id: 'req-1', name: 'Заявка нормальная' },
        { id: 'req-2' }, // нет name — должна быть пропущена
      ],
    });
    assert.equal(status, 200);
    assert.equal(json.restored.requests, 1);
    const names = db.exec('SELECT name FROM requests')[0].values.map(r => r[0]);
    assert.deepEqual(names, ['Заявка нормальная']);
  } finally { close(); }
});

test('restore без admin-токена отклоняется (viewer)', async () => {
  const { port, close } = await setup();
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // без x-auth-token → viewer
      body: JSON.stringify({ users: [{ username: 'x', password: 'y', role: 'admin' }] }),
    });
    assert.equal(resp.status, 403);
  } finally { close(); }
});

test('restore с чужим/неверным токеном отклоняется', async () => {
  const { port, close } = await setup();
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': 'totally-fake-token' },
      body: JSON.stringify({ users: [{ username: 'x', password: 'y', role: 'admin' }] }),
    });
    assert.equal(resp.status, 403);
  } finally { close(); }
});
