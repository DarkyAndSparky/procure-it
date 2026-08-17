// Поднимает реальный сервер procure-it (server.js) как дочерний процесс, с
// изолированной временной папкой данных (PROCURE_DATA_DIR) и случайным
// портом — так тесты бьют по НАСТОЯЩЕМУ HTTP-серверу (не мокают отдельные
// функции), но не мешают друг другу и не трогают реальные data/.
const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freePort() {
  // Простой способ получить свободный порт без лишних зависимостей —
  // спросить у самой ОС через временный net-сервер.
  const net = require('net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Запрос к серверу с самоподписанным сертификатом — как curl -k в ручных
// проверках этой сессии.
function request(baseUrl, method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Auth-Token'] = token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(url, { method, headers, rejectUnauthorized: false, timeout: 10000 }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch(e) { /* not JSON — тело останется в raw */ }
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function startTestServer() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procure-it-test-'));
  const baseUrl = `https://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), PROCURE_DATA_DIR: dataDir, NODE_ENV: 'test' },
    cwd: path.join(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let startupLog = '';
  child.stdout.on('data', d => { startupLog += d.toString(); });
  child.stderr.on('data', d => { startupLog += d.toString(); });

  // Ждём готовности — опрашиваем /health, а не фиксированную паузу: на
  // медленной машине генерация self-signed сертификата может занять больше
  // времени, чем захардкоженный sleep.
  const deadline = Date.now() + 20000;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Тестовый сервер упал при старте (код ${child.exitCode}):\n${startupLog}`);
    }
    try {
      const res = await request(baseUrl, 'GET', '/health');
      if (res.status === 200) {
        return { baseUrl, port, dataDir, child, request: (method, p, opts) => request(baseUrl, method, p, opts) };
      }
    } catch(e) { lastErr = e; }
    await new Promise(r => setTimeout(r, 200));
  }
  child.kill('SIGKILL');
  throw new Error(`Тестовый сервер не поднялся за 20с. Последняя ошибка: ${lastErr && lastErr.message}\nЛог:\n${startupLog}`);
}

async function stopTestServer(server) {
  if (!server) return;
  await new Promise((resolve) => {
    server.child.once('exit', resolve);
    server.child.kill('SIGTERM');
    // На случай если graceful shutdown зависнет — не даём тесту висеть вечно.
    setTimeout(() => { try { server.child.kill('SIGKILL'); } catch(e) {} resolve(); }, 5000);
  });
  try { fs.rmSync(server.dataDir, { recursive: true, force: true }); } catch(e) {}
}

module.exports = { startTestServer, stopTestServer };
