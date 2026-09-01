// Тесты на postJson() из bitrixService.js — конкретно на таймаут,
// добавленный при аудите перед слиянием dev→main. До фикса запрос к
// вебхуку не имел таймаута вообще: недоступный/зависший вебхук вешал
// запрос НАВСЕГДА, а POST /api/send-bitrix ждёт его синхронно в
// обработчике — конкретный HTTP-запрос пользователя не завершался никогда.
//
// Используем короткий timeoutMs (не боевые 15с — иначе каждый прогон
// npm test удлинялся бы на 15+ секунд ради одного теста) — сам механизм
// (req.on('timeout')/destroy()/reject()) один и тот же независимо от
// длительности отсечки.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { postJson } = require('../src/services/bitrixService');

test('postJson: успешный ответ парсится как JSON', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, echo: 'test' }));
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const result = await postJson(`http://127.0.0.1:${port}/webhook`, { test: 1 });
    assert.deepEqual(result, { ok: true, echo: 'test' });
  } finally { server.close(); }
});

test('postJson: не-JSON ответ отдаётся как { raw }, не бросает исключение', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('не json вообще');
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const result = await postJson(`http://127.0.0.1:${port}/webhook`, { test: 1 });
    assert.deepEqual(result, { raw: 'не json вообще' });
  } finally { server.close(); }
});

test('postJson: зависший сервер (соединение принято, ответа нет) — реджектится по таймауту, не висит вечно', async () => {
  const server = http.createServer(() => { /* намеренно не отвечаем */ });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const t0 = Date.now();
    await assert.rejects(
      () => postJson(`http://127.0.0.1:${port}/webhook`, { test: 1 }, 200), // 200мс вместо боевых 15000
      /Таймаут запроса к вебхуку/
    );
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 2000, `таймаут должен сработать быстро (уложился в ${elapsed}мс), не зависнуть`);
    assert.ok(elapsed >= 190, `таймаут не должен срабатывать РАНЬШЕ отведённого времени (сработал через ${elapsed}мс)`);
  } finally { server.close(); }
});

test('postJson: недоступный порт (нет сервера) — реджектится сразу, не через таймаут', async () => {
  // Порт, на котором заведомо никто не слушает — ECONNREFUSED должен
  // прилететь сразу через req.on('error'), а не ждать полный таймаут.
  const t0 = Date.now();
  await assert.rejects(
    () => postJson('http://127.0.0.1:1/webhook', { test: 1 }, 5000),
  );
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, `ECONNREFUSED должен прилетать сразу, а не ждать таймаут (заняло ${elapsed}мс)`);
});
