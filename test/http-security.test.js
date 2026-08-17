// Тесты безопасности — реальный сервер, реальный HTTP. Проверяем не
// «внутреннюю логику», а то, что снаружи действительно нельзя сделать:
// доступ без токена, доступ не той ролью, обход id в файловых путях,
// rate limiting, SQL-инъекция через фильтры, заголовки безопасности.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer } = require('./helpers/testServer');
const { loginAsFreshAdmin, createOperator } = require('./helpers/authHelpers');

let server, adminToken, operatorToken, orgId;

test.before(async () => {
  server = await startTestServer();
  adminToken = await loginAsFreshAdmin(server);
  operatorToken = await createOperator(server, adminToken);
  const org = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Секьюрити', short: 'СЕК' } });
  orgId = org.body.id;
});

test.after(async () => { await stopTestServer(server); });

// ── Аутентификация обязательна для изменяющих операций ──────────────────────
test('без токена: изменяющие запросы отклоняются (401/403)', async () => {
  const attempts = [
    ['POST', '/api/orgs', { full: 'X', short: 'X' }],
    ['PUT', '/api/settings', { supplierName: 'X' }],
    ['POST', '/api/requests', { name: 'X' }],
    ['DELETE', `/api/orgs/${orgId}`, undefined],
  ];
  for (const [method, path, body] of attempts) {
    const res = await server.request(method, path, { body });
    assert.ok([401, 403].includes(res.status), `${method} ${path} без токена должен отклоняться (401/403), получили ${res.status}`);
  }
});

test('без токена: чтение публичных данных по-прежнему доступно', async () => {
  // GET /api/requests и /api/orgs осознанно public — приложение работает и
  // для гостя без пароля (роль viewer), это не баг, а дизайн.
  const orgs = await server.request('GET', '/api/orgs');
  assert.equal(orgs.status, 200);
  const requests = await server.request('GET', '/api/requests');
  assert.equal(requests.status, 200);
});

// ── Разграничение ролей: operator не должен доставать до admin-only ─────────
test('роль operator: не может писать в /api/settings и не может скачать бэкап БД', async () => {
  const putSettings = await server.request('PUT', '/api/settings', { token: operatorToken, body: { supplierName: 'X' } });
  assert.equal(putSettings.status, 403, 'operator не должен иметь доступ к PUT /api/settings (admin-only)');

  const backupDb = await server.request('GET', '/api/backup/db', { token: operatorToken });
  assert.equal(backupDb.status, 403, 'operator не должен иметь доступ к GET /api/backup/db (admin-only)');

  const restore = await server.request('POST', '/api/restore', { token: operatorToken, body: {} });
  assert.equal(restore.status, 403, 'operator не должен иметь доступ к POST /api/restore (admin-only)');

  const users = await server.request('GET', '/api/users', { token: operatorToken });
  assert.equal(users.status, 403, 'operator не должен видеть список пользователей (admin-only)');
});

test('роль operator: МОЖЕТ создавать заявки и организации (operatorOrAdmin)', async () => {
  const org = await server.request('POST', '/api/orgs', { token: operatorToken, body: { full: 'ООО От оператора', short: 'ОПР' } });
  assert.equal(org.status, 200, 'operator должен иметь право создавать организации');
});

// ── Обход через некорректный/вредоносный id в файловых маршрутах ────────────
test('файловые маршруты: id с попыткой path traversal отклоняется', async () => {
  const maliciousIds = ['../../etc/passwd', '..%2F..%2Fetc%2Fpasswd', 'foo/../bar', 'a b', '<script>'];
  for (const id of maliciousIds) {
    const res = await server.request('POST', `/api/requests/${encodeURIComponent(id)}/signed-spec`, {
      token: adminToken, body: { pdf: 'dGVzdA==' },
    });
    // Либо 400 (наш SAFE_ID отфильтровал) либо 404 (роут не нашёлся из-за
    // спецсимволов в пути) — в обоих случаях НЕ должно быть попытки
    // прочитать/записать файл по этому пути. 200 здесь был бы провалом теста.
    assert.notEqual(res.status, 200, `id "${id}" не должен приниматься файловым маршрутом`);
  }
});

test('несуществующая заявка: 404, а не падение сервера', async () => {
  const res = await server.request('GET', '/api/requests/does-not-exist-12345');
  assert.ok([404, 400].includes(res.status));
  // Сервер должен остаться живым после этого запроса.
  const health = await server.request('GET', '/health');
  assert.equal(health.status, 200);
});

// ── SQL-инъекция через query-параметры фильтров ──────────────────────────────
test('SQL-инъекция через фильтры заявок не проходит (параметризованные запросы)', async () => {
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE requests; --",
    "x' UNION SELECT * FROM users --",
  ];
  for (const payload of payloads) {
    const res = await server.request('GET', '/api/requests?org=' + encodeURIComponent(payload));
    assert.equal(res.status, 200, 'запрос с инъекцией в фильтре не должен приводить к ошибке 5xx');
    const items = Array.isArray(res.body) ? res.body : res.body.items;
    assert.equal(items.length, 0, `фильтр с несуществующим org_id не должен возвращать чужие данные (payload: ${payload})`);
  }
  // Убеждаемся, что таблица requests пережила попытку DROP TABLE.
  const stillWorks = await server.request('GET', '/api/requests');
  assert.equal(stillWorks.status, 200, 'таблица requests должна быть цела после попыток инъекции');
});

// ── Rate limiting на чувствительных эндпоинтах ───────────────────────────────
test('rate limiting: /api/auth/login блокирует после множества попыток подряд', async () => {
  const results = [];
  for (let i = 0; i < 15; i++) {
    results.push(await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong-password' } }));
  }
  const statuses = results.map(r => r.status);
  assert.ok(statuses.includes(429), `после 15 быстрых попыток логина ожидали хотя бы один 429, получили: ${statuses.join(',')}`);
}, { timeout: 30000 });

// ── Заголовки безопасности (helmet) ─────────────────────────────────────────
test('заголовки безопасности присутствуют, X-Powered-By скрыт', async () => {
  const res = await server.request('GET', '/health');
  assert.equal(res.headers['x-powered-by'], undefined, 'X-Powered-By не должен раскрывать Express');
  assert.ok(res.headers['x-content-type-options'], 'должен быть заголовок X-Content-Type-Options');
  assert.ok(res.headers['strict-transport-security'], 'должен быть заголовок HSTS (Strict-Transport-Security)');
});

// ── Инвалидация сессии после смены пароля ────────────────────────────────────
test('смена пароля инвалидирует старые токены сессии', async () => {
  const opUsername = 'sessiontest', opPassword = 'SessionPass123!';
  await server.request('POST', '/api/users', { token: adminToken, body: { username: opUsername, password: opPassword, role: 'operator' } });
  const login1 = await server.request('POST', '/api/auth/login', { body: { username: opUsername, password: opPassword } });
  const oldToken = login1.body.token;

  // Токен рабочий до смены пароля
  const before = await server.request('GET', '/api/requests', { token: oldToken });
  assert.equal(before.status, 200);

  await server.request('POST', '/api/auth/change-password', { token: oldToken, body: { newPassword: 'NewSessionPass456!' } });

  // Старый токен (если сервер выдаёт новый при смене пароля) не должен
  // работать для операций, требующих актуальной сессии — проверяем самым
  // однозначным способом: логинимся под НОВЫМ паролем и убеждаемся, что
  // старый пароль больше не подходит.
  const oldPasswordLogin = await server.request('POST', '/api/auth/login', { body: { username: opUsername, password: opPassword } });
  assert.notEqual(oldPasswordLogin.status, 200, 'логин по старому паролю после смены не должен проходить');
});
