const fs = require('fs');
const { CERT_FILE, KEY_FILE } = require('./config');

let selfsigned;
try { selfsigned = require('selfsigned'); } catch(e) { selfsigned = null; }

function ensureCert() {
  // Validate existing cert
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    try {
      const k = fs.readFileSync(KEY_FILE,  'utf8');
      const c = fs.readFileSync(CERT_FILE, 'utf8');
      if (k.includes('BEGIN') && c.includes('BEGIN')) {
        console.log('[HTTPS] Сертификат найден и валиден');
        return true;
      }
    } catch(e) {}
    console.log('[HTTPS] Сертификат повреждён, пересоздаём...');
    try { fs.unlinkSync(KEY_FILE);  } catch(e) {}
    try { fs.unlinkSync(CERT_FILE); } catch(e) {}
  }

  console.log('[HTTPS] Генерация самоподписанного сертификата...');

  // ── Strategy 1: openssl (Git for Windows / Linux / macOS) ──────────────────
  try {
    const { execSync } = require('child_process');

    // Check openssl available
    execSync('openssl version', { stdio: 'pipe' });

    const opensslCmd = [
      'openssl req -x509 -newkey rsa:2048 -nodes',
      `-keyout "${KEY_FILE}"`,
      `-out "${CERT_FILE}"`,
      '-days 3650',
      '-sha256',
      '-subj "/CN=localhost/O=procure-it/C=RU"',
      `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
    ].join(' ');

    execSync(opensslCmd, { stdio: 'pipe' });

    // Verify
    const k = fs.readFileSync(KEY_FILE,  'utf8');
    const c = fs.readFileSync(CERT_FILE, 'utf8');
    if (k.includes('BEGIN') && c.includes('BEGIN')) {
      console.log('[HTTPS] ✓ Сертификат создан через openssl');
      return true;
    }
  } catch(e) {
    console.log('[HTTPS] openssl недоступен, пробуем selfsigned...');
  }

  // ── Strategy 2: selfsigned npm package ─────────────────────────────────────
  if (selfsigned) {
    try {
      const attrs = [
        { name: 'commonName',       value: 'localhost' },
        { name: 'organizationName', value: 'procure-it' },
        { name: 'countryName',      value: 'RU' },
      ];
      const opts = {
        days: 3650,
        algorithm: 'sha256',
        keySize: 2048,
        extensions: [{
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        }],
      };
      const pems = selfsigned.generate(attrs, opts);

      // Normalize line endings (critical on Windows)
      const normalize = (s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() + '\n';
      const cleanKey  = normalize(pems.private);
      const cleanCert = normalize(pems.cert);

      fs.writeFileSync(KEY_FILE,  cleanKey,  { encoding: 'utf8' });
      fs.writeFileSync(CERT_FILE, cleanCert, { encoding: 'utf8' });

      // Verify written files
      const k = fs.readFileSync(KEY_FILE,  'utf8');
      const c = fs.readFileSync(CERT_FILE, 'utf8');
      if (!k.includes('BEGIN') || !c.includes('BEGIN')) {
        throw new Error('PEM файлы записаны некорректно');
      }

      console.log('[HTTPS] ✓ Сертификат создан через selfsigned');
      return true;
    } catch(e) {
      console.error('[HTTPS] selfsigned ошибка:', e.message);
    }
  }

  // ── Strategy 3: Node.js built-in crypto (Node 18+) ─────────────────────────
  // Оставлено как документация неудачного пути, а не рабочая ветка: у
  // Node.js crypto нет своего ASN.1-энкодера для X.509, только строительные
  // блоки (генерация ключей, подпись) — этого недостаточно для готового
  // сертификата без сторонней библиотеки (см. Strategy 2 выше — selfsigned).
  try {
    console.log('[HTTPS] Попытка через Node.js crypto...');
    // Node.js 18+ has X509Certificate but not cert generation
    // Fall through to HTTP mode
    throw new Error('Node.js crypto не поддерживает генерацию X.509 напрямую');
  } catch(e) {
    // Expected
  }

  console.warn('[HTTPS] ⚠ Не удалось создать сертификат — сервер запустится по HTTP');
  console.warn('[HTTPS] Установите Git for Windows (содержит openssl) и перезапустите');
  return false;
}

module.exports = { ensureCert };
