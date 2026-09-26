// Регрессионные тесты на POST/PUT /api/users — конкретно на баг, найденный
// при аудите (26w36-b16): db/connection.js#run() намеренно НЕ бросает
// исключение при нарушении UNIQUE (email/username задублированы) — он
// молча возвращает false, и вызывающий код должен сам проверить возврат.
// routes/auth.js этого не делал: try/catch на e.message.includes('UNIQUE')
// был мёртвым кодом (run() никогда не бросает), из-за чего повторное
// создание пользователя с тем же username или email отвечало {ok:true},
// хотя INSERT/UPDATE молча проваливался и ничего не менялось. Подтверждено
// вживую через curl против реального поднятого сервера перед фиксом.
//
// Тот же приём изоляции от диска, что в test/backup-restore.test.js:
// чистая in-memory sql.js БД + подмена db/connection.js в require.cache,
// реальный HTTP через express + настоящий adminOnly-мидлвар (а не вызов
// внутренней функции напрямую) — дублирование именно то, что молча ловится
// на уровне SQL, а не на уровне валидации входных данных.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const initSqlJs = require('sql.js');
const { runMigrations } = require('../src/db/schema');

async function setup() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db); // создаёт уникальный индекс users.email (если получится) + сеет default admin

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

  ['../src/routes/auth', '../src/auth/sessions', '../src/auth/middleware', '../src/auth/users'].forEach(p => {
    delete require.cache[require.resolve(p)];
  });
  const { sessionCreate } = require('../src/auth/sessions');
  const authRouterFactory = require('../src/routes/auth');

  db.run('DELETE FROM users');
  db.run("INSERT INTO users (id,username,password,salt,role,must_change_password) VALUES (1,'testadmin','x','y','admin',0)");
  const token = 'test-admin-token';
  sessionCreate(token, 1);

  const app = express();
  app.use(express.json());
  const noopLimiter = (req, res, next) => next();
  app.use('/api', authRouterFactory(noopLimiter));

  const server = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  async function call(method, path, body) {
    const resp = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, json: await resp.json() };
  }

  return { db, call, close: () => server.close() };
}

test('POST /api/users: повторное создание того же username отклоняется 409, не молчит', async () => {
  const { db, call, close } = await setup();
  try {
    const first = await call('POST', '/api/users', { username: 'bob', password: 'Bobpass123', role: 'viewer' });
    assert.equal(first.status, 200);

    const second = await call('POST', '/api/users', { username: 'bob', password: 'Otherpass123', role: 'viewer' });
    assert.equal(second.status, 409, 'дубль username должен явно отклоняться, а не отвечать ok:true');
    assert.match(second.json.error, /логин/i);

    const count = db.exec("SELECT COUNT(*) FROM users WHERE username='bob'")[0].values[0][0];
    assert.equal(count, 1, 'в БД должна остаться ровно одна запись bob');
  } finally { close(); }
});

test('POST /api/users: два пользователя с одинаковым email отклоняются 409', async () => {
  const { db, call, close } = await setup();
  try {
    const first = await call('POST', '/api/users', { username: 'bob', password: 'Bobpass123', role: 'viewer', email: 'shared@example.com' });
    assert.equal(first.status, 200);

    const second = await call('POST', '/api/users', { username: 'carol', password: 'Carolpass123', role: 'viewer', email: 'shared@example.com' });
    assert.equal(second.status, 409, 'дубль email должен явно отклоняться');
    assert.match(second.json.error, /email/i);

    const carolExists = db.exec("SELECT COUNT(*) FROM users WHERE username='carol'")[0].values[0][0];
    assert.equal(carolExists, 0, 'carol не должна была создаться вообще');
  } finally { close(); }
});

test('POST /api/users: несколько пользователей БЕЗ email (пустая строка) не конфликтуют друг с другом', async () => {
  const { call, close } = await setup();
  try {
    const a = await call('POST', '/api/users', { username: 'dave', password: 'Davepass123', role: 'viewer' });
    assert.equal(a.status, 200);
    const b = await call('POST', '/api/users', { username: 'erin', password: 'Erinpass123', role: 'viewer' });
    assert.equal(b.status, 200, 'два пользователя без email не должны считаться дублями друг друга');
  } finally { close(); }
});

test('PUT /api/users/:id: смена email на уже занятый чужой email отклоняется 409, не меняет запись', async () => {
  const { db, call, close } = await setup();
  try {
    await call('POST', '/api/users', { username: 'bob', password: 'Bobpass123', role: 'viewer', email: 'bob@example.com' });
    await call('POST', '/api/users', { username: 'dave', password: 'Davepass123', role: 'viewer' });
    const daveId = db.exec("SELECT id FROM users WHERE username='dave'")[0].values[0][0];

    const res = await call('PUT', `/api/users/${daveId}`, { email: 'bob@example.com' });
    assert.equal(res.status, 409, 'попытка присвоить чужой email должна отклоняться');

    const daveEmail = db.exec(`SELECT email FROM users WHERE id=${daveId}`)[0].values[0][0];
    assert.equal(daveEmail, '', 'email dave не должен был измениться при отклонённом обновлении');
  } finally { close(); }
});

test('PUT /api/users/:id: смена email на свободный проходит успешно', async () => {
  const { db, call, close } = await setup();
  try {
    await call('POST', '/api/users', { username: 'dave', password: 'Davepass123', role: 'viewer' });
    const daveId = db.exec("SELECT id FROM users WHERE username='dave'")[0].values[0][0];

    const res = await call('PUT', `/api/users/${daveId}`, { email: 'dave@example.com' });
    assert.equal(res.status, 200);

    const daveEmail = db.exec(`SELECT email FROM users WHERE id=${daveId}`)[0].values[0][0];
    assert.equal(daveEmail, 'dave@example.com');
  } finally { close(); }
});
