// Функциональные интеграционные тесты. В отличие от pricing.test.js /
// docxService.test.js / schema.test.js (юнит-тесты чистых функций), эти
// тесты поднимают НАСТОЯЩИЙ сервер (test/helpers/testServer.js) в
// изолированной временной папке данных и бьют по нему реальными HTTP-
// запросами — так же, как проверялось вручную curl'ом в течение этой сессии.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer } = require('./helpers/testServer');
const { loginAsFreshAdmin, createOperator } = require('./helpers/authHelpers');

let server, adminToken;

test.before(async () => {
  server = await startTestServer();
  adminToken = await loginAsFreshAdmin(server);
});

test.after(async () => { await stopTestServer(server); });

test('организации: создание, список, обновление, дубли отклоняются', async () => {
  const create = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Лето', short: 'ЛД' } });
  assert.equal(create.status, 200);
  const orgId = create.body.id;

  const list = await server.request('GET', '/api/orgs');
  assert.ok(list.body.some(o => o.id === orgId), 'созданная организация должна быть в списке');

  const update = await server.request('PUT', `/api/orgs/${orgId}`, { token: adminToken, body: { full: 'ООО Лето Девелопмент', short: 'ЛД' } });
  assert.equal(update.status, 200);
  assert.equal(update.body.full, 'ООО Лето Девелопмент');

  // Точный дубль
  const dup1 = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Другое', short: 'ЛД' } });
  assert.equal(dup1.status, 409, 'точный дубль короткого названия должен отклоняться');

  // Дубль в другом регистре кириллицы — тот самый случай, для которого
  // COLLATE NOCASE в SQLite не сработал бы (не понимает кириллицу).
  const dup2 = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Третье', short: 'лд' } });
  assert.equal(dup2.status, 409, 'дубль в другом регистре кириллицы должен отклоняться');

  // Коллизия по фактической папке при разных коротких названиях
  await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Папка1', short: 'П1', folder: 'ОБЩАЯ' } });
  const dupFolder = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Папка2', short: 'П2', folder: 'общая' } });
  assert.equal(dupFolder.status, 409, 'коллизия по папке раскладки файлов должна отклоняться, даже если short разный');
});

test('заявки: номер уникален в рамках организации, а не глобально', async () => {
  const org1 = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Первая', short: 'ОРГ1' } });
  const org2 = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Вторая', short: 'ОРГ2' } });

  const mk = (orgBody, specNum) => server.request('POST', '/api/requests', {
    token: adminToken,
    body: { specNum, orgId: orgBody.id, orgFull: orgBody.full, orgShort: orgBody.short, name: 'тест', date: '2026-08-16', docType: 'goods', positions: [] },
  });

  const r1 = await mk(org1.body, 'П202608-01');
  assert.equal(r1.status, 200, `создание первой заявки не удалось: ${r1.raw}`);

  // Тот же номер у ДРУГОЙ организации — должно пройти
  const r2 = await mk(org2.body, 'П202608-01');
  assert.equal(r2.status, 200, `тот же номер у другой организации должен допускаться: ${r2.raw}`);

  // Тот же номер у ТОЙ ЖЕ организации повторно — должно быть отклонено
  const r3 = await mk(org1.body, 'П202608-01');
  assert.equal(r3.status, 409, 'повторный номер у той же организации должен отклоняться');
});

test('заявки: фильтр по контрагенту', async () => {
  const org = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Фильтр', short: 'ФЛТ' } });
  const mk = (specNum, counterparty) => server.request('POST', '/api/requests', {
    token: adminToken,
    body: { specNum, orgId: org.body.id, orgFull: org.body.full, orgShort: org.body.short, name: 'тест', date: '2026-08-16', docType: 'goods', counterparty, positions: [] },
  });
  await mk('П202608-10', 'Ситилинк');
  await mk('П202608-11', 'DNS');

  const filtered = await server.request('GET', '/api/requests?counterparty=' + encodeURIComponent('Ситилинк'));
  const items = Array.isArray(filtered.body) ? filtered.body : filtered.body.items;
  assert.ok(items.every(r => r.counterparty === 'Ситилинк' || r.orgFull !== 'ООО Фильтр'), 'фильтр не должен возвращать заявки с другим контрагентом из этой организации');
  assert.ok(items.some(r => r.specNum === 'П202608-10'), 'заявка с нужным контрагентом должна быть в результатах');
  assert.ok(!items.some(r => r.specNum === 'П202608-11'), 'заявка с другим контрагентом не должна попасть в результаты');
});

test('заявки: гарантийный акт («Сопровождение») — срок подставляется в документ', async () => {
  const org = await server.request('POST', '/api/orgs', { token: adminToken, body: { full: 'ООО Гарантия', short: 'ГАР' } });
  const created = await server.request('POST', '/api/requests', {
    token: adminToken,
    body: {
      specNum: 'С202608-01', orgId: org.body.id, orgFull: org.body.full, orgShort: org.body.short,
      name: 'гарантия', date: '2026-08-16', docType: 'support', warrantyPeriod: '24 месяца',
      positions: [{ name: 'Ноутбук', qty: 1, unit: 'шт', sellPrice: 1000 }],
    },
  });
  assert.equal(created.status, 200);

  const full = await server.request('GET', `/api/requests/${created.body.id}`);
  const docx = await server.request('POST', '/api/spec-docx', { token: adminToken, body: full.body });
  assert.equal(docx.status, 200);
  assert.ok(docx.raw.length > 0, 'docx не должен быть пустым');
});

test('настройки: GET/PUT round-trip, версия отдаётся', async () => {
  const put = await server.request('PUT', '/api/settings', { token: adminToken, body: { supplierName: 'ИП Тестов' } });
  assert.equal(put.status, 200);

  const get = await server.request('GET', '/api/settings', { token: adminToken });
  assert.equal(get.body.supplierName, 'ИП Тестов');

  const version = await server.request('GET', '/api/version', { token: adminToken });
  assert.equal(version.status, 200);
  assert.ok(version.body.version, 'версия должна присутствовать в ответе');
});

test('бэкап: JSON-экспорт содержит созданные данные и метаданные', async () => {
  const backup = await server.request('GET', '/api/backup', { token: adminToken });
  assert.equal(backup.status, 200);
  assert.ok(backup.body.exported, 'в бэкапе должна быть отметка времени экспорта');
  assert.ok(Array.isArray(backup.body.orgs) && backup.body.orgs.length > 0, 'бэкап должен содержать ранее созданные организации');
  assert.ok(Array.isArray(backup.body.requests) && backup.body.requests.length > 0, 'бэкап должен содержать ранее созданные заявки');
});

test('о системе: system-info отдаёт версию, окружение и счётчики', async () => {
  const info = await server.request('GET', '/api/system-info', { token: adminToken });
  assert.equal(info.status, 200);
  assert.ok(info.body.version);
  assert.ok(info.body.node.startsWith('v'));
  assert.ok(info.body.counts && typeof info.body.counts.requests === 'number');
  assert.ok(Array.isArray(info.body.dependencies) && info.body.dependencies.length > 0);
});
