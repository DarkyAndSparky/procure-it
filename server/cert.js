'use strict';
/**
 * cert.js — генерация самоподписанного TLS-сертификата
 * Использует пакет `selfsigned` (без системного openssl).
 * Сертификат сохраняется в <data>/cert.pem + <data>/key.pem, где <data> —
 * IT_ASSETS_DATA_DIR (если задана) или data/ в корне проекта.
 * При повторном запуске — переиспользуется если не истёк.
 */

const fs          = require('fs');
const path        = require('path');
const os          = require('os');
const selfsigned  = require('selfsigned');
const logger      = require('./logger');

// Та же логика, что в server/db/store.js — уважаем IT_ASSETS_DATA_DIR,
// чтобы сертификат хранился рядом с данными (важно для изолированных
// окружений — например, E2E-тестов с отдельной data-директорией).
const DATA_DIR = process.env.IT_ASSETS_DATA_DIR
  ? path.resolve(process.env.IT_ASSETS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CERT_FILE = path.join(DATA_DIR, 'cert.pem');
const KEY_FILE  = path.join(DATA_DIR, 'key.pem');
const CERT_DAYS = 825; // ~2.25 года (максимум для браузеров)

/** Все локальные IPv4 адреса включая loopback */
function getLocalIPs() {
  const ips = new Set(['127.0.0.1']);
  try {
    for (const iface of Object.values(os.networkInterfaces()))
      for (const net of iface)
        if (net.family === 'IPv4') ips.add(net.address);
  } catch(e) {}
  return [...ips];
}

/**
 * Дней до истечения сертификата, или null если файлов нет / не удалось
 * прочитать. Вынесено отдельно от isCertValid() — INFRA-6 (health-бар)
 * нужно именно число дней, а не бинарный valid/invalid с порогом в 30 дней.
 */
function certDaysLeft() {
  try {
    if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) return null;
    if (fs.statSync(CERT_FILE).size < 100)                      return null;

    const certPem  = fs.readFileSync(CERT_FILE, 'utf8');
    const certBody = certPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    const der      = Buffer.from(certBody, 'base64');

    const { X509Certificate } = require('crypto');
    const x509     = new X509Certificate(der);
    const validTo  = new Date(x509.validTo);
    return Math.round((validTo - Date.now()) / (1000 * 60 * 60 * 24));
  } catch(e) {
    return null; // X509Certificate недоступен или файл повреждён
  }
}

/** Проверить что существующий сертификат ещё действителен (> 30 дней) */
function isCertValid() {
  try {
    if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) return false;
    if (fs.statSync(CERT_FILE).size < 100)                      return false;
    if (fs.statSync(KEY_FILE).size  < 100)                      return false;

    const daysLeft = certDaysLeft();
    if (daysLeft == null) return true; // не смогли прочитать дату — не блокируем запуск
    if (daysLeft < 30) {
      logger.info('TLS', `Сертификат истекает через ${daysLeft} дней — перегенерируем`);
      return false;
    }
    logger.info('TLS', `Сертификат действителен ещё ${daysLeft} дней`);
    return true;
  } catch(e) {
    return false;
  }
}

/** Сгенерировать новый сертификат и сохранить */
async function generateCert() {
  const ips  = getLocalIPs();
  logger.info('TLS', `Генерируем сертификат для: localhost, ${ips.join(', ')}`);

  const attrs = [
    { name: 'commonName',         value: 'localhost' },
    { name: 'organizationName',   value: 'IT Assets'  },
    { name: 'countryName',        value: 'RU'         },
  ];

  const opts = {
    days:    CERT_DAYS,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },       // DNS
          { type: 2, value: '*.localhost' },      // DNS wildcard
          ...ips.map(ip => ({ type: 7, ip })),    // IP SANs
        ],
      },
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', keyCertSign: false, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
    ],
  };

  const pems = await selfsigned.generate(attrs, opts);

  // Сохраняем с ограниченными правами
  fs.writeFileSync(CERT_FILE, pems.cert,    { mode: 0o644 });
  fs.writeFileSync(KEY_FILE,  pems.private, { mode: 0o600 });

  logger.info('TLS', `Сертификат сохранён (${CERT_DAYS} дней, RSA-2048, SHA-256)`);
  return { cert: pems.cert, key: pems.private };
}

/**
 * Основная функция: получить или создать сертификат.
 * Возвращает { key, cert } в виде строк PEM.
 */
async function ensureCert() {
  if (isCertValid()) {
    return {
      key:  fs.readFileSync(KEY_FILE,  'utf8'),
      cert: fs.readFileSync(CERT_FILE, 'utf8'),
    };
  }
  return await generateCert();
}

module.exports = { ensureCert, getLocalIPs, certDaysLeft, CERT_FILE, KEY_FILE };
