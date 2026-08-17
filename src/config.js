const path = require('path');
const fs   = require('fs');

const PORT       = parseInt(process.env.PORT || '9111');
const ROOT_DIR   = path.join(__dirname, '..');
// PROCURE_DATA_DIR — позволяет указать свою папку данных (например, изолированную
// временную папку для интеграционных тестов, см. test/helpers/testServer.js).
// По умолчанию — прежнее поведение (data/ внутри проекта), ничего не меняется
// для обычного запуска.
const DATA_DIR   = process.env.PROCURE_DATA_DIR ? path.resolve(process.env.PROCURE_DATA_DIR) : path.join(ROOT_DIR, 'data');
const DB_FILE    = path.join(DATA_DIR, 'zakupki.db');
const CERT_DIR   = path.join(DATA_DIR, 'certs');
const SIGNED_DIR = path.join(DATA_DIR, 'signed_specs');
const INVOICE_DIR = path.join(DATA_DIR, 'invoices');
const BACKUP_DIR  = path.join(DATA_DIR, 'backups');
const CERT_FILE   = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE    = path.join(CERT_DIR, 'key.pem');

// ── Ensure dirs ───────────────────────────────────────────────────────────────
[DATA_DIR, CERT_DIR, SIGNED_DIR, INVOICE_DIR, BACKUP_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Legacy single-password support: if PROCURE_PASSWORD set and no users in DB,
// it acts as the admin password (backward compatible).
const LEGACY_PASSWORD = process.env.PROCURE_PASSWORD || '';
const AUTH_ENABLED    = true; // always true — viewer role = no password

const DEFAULT_SETTINGS = {
  appName:        'Закупки ИТ',
  appSubtitle:    'Управление заявками',
  logoBase64:     '',
  accentLight:    '#2563eb',
  accentDark:     '#60a5fa',
  successLight:   '#16a34a',
  successDark:    '#4ade80',
  bitrixWebhook:  '',   // URL вида https://your.bitrix24.ru/rest/1/key/
  statusWebhook:  '',   // POST JSON при смене статуса заявки
  networkFolder:  '',   // Путь к сетевой папке, напр. \\\\server\\share или /mnt/share
  networkUser:    '',   // Логин для сетевой папки (Windows: домен\\пользователь)
  networkPass:    '',   // Пароль для сетевой папки
  supplierName:      '', // Наименование поставщика по умолчанию
  supplierSignatory: '', // ФИО подписанта поставщика
  supplierStamp:     '0', // '1' — с печатью (М.П.), '0' — без
  backupFolder:      '', // Свой путь для бэкапов (напр. на другой диск/сетевую папку).
                         // Пусто — бэкапы остаются в data/backups, как раньше.
};

const RU_MONTHS_FOLDER = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

module.exports = {
  PORT, ROOT_DIR, DATA_DIR, DB_FILE, CERT_DIR, SIGNED_DIR, INVOICE_DIR, BACKUP_DIR,
  CERT_FILE, KEY_FILE, LEGACY_PASSWORD, AUTH_ENABLED, DEFAULT_SETTINGS, RU_MONTHS_FOLDER,
};
