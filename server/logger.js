/**
 * server/logger.js
 *
 * Фаза 7b рефакторинга: структурированное логирование операционных событий
 * (миграции, TLS, бэкапы, ошибки), не блокер для LAN-инструмента, поэтому —
 * без внешних зависимостей (pino/winston), тонкий самописный враппер.
 *
 * НЕ заменяет стартовый ASCII-баннер в index.js (порты/IP/инструкции для
 * пользователя в терминале) — это человеко-читаемый CLI-вывод, не событие.
 *
 * Формат файла: JSON-строки (по одной записи на строку), ротация по дате —
 * новый файл на каждый день, хранится RETENTION_DAYS файлов, старые удаляются
 * при старте процесса.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.IT_ASSETS_DATA_DIR
  ? path.resolve(process.env.IT_ASSETS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const RETENTION_DAYS = parseInt(process.env.IT_ASSETS_LOG_RETENTION_DAYS, 10) || 14;
const SILENT = process.env.NODE_ENV === 'test'; // тесты не должны писать на диск/в консоль

function ensureLogDir() {
  if (!SILENT && !fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function todayFile() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `app-${ymd}.log`);
}

function rotateOldFiles() {
  if (SILENT) return;
  try {
    ensureLogDir();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const full = path.join(LOG_DIR, f);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch (e) {
    // ротация не должна ронять сервер
    console.error('[logger] rotation failed:', e.message);
  }
}

function write(level, tag, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level, tag, message,
    ...(meta !== undefined ? { meta } : {}),
  };

  if (!SILENT) {
    try {
      ensureLogDir();
      fs.appendFileSync(todayFile(), JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error('[logger] write failed:', e.message);
    }
  }

  if (!SILENT) {
    // человекочитаемое зеркало в консоль — сохраняет прежний вид вывода в
    // терминале; в тестах отключено, чтобы не шуметь в выводе Jest
    const line = `[${tag}] ${message}`;
    if (level === 'error') console.error(line, meta !== undefined ? meta : '');
    else if (level === 'warn') console.warn(line, meta !== undefined ? meta : '');
    else console.log(line, meta !== undefined ? meta : '');
  }
}

rotateOldFiles();

module.exports = {
  info:  (tag, message, meta) => write('info',  tag, message, meta),
  warn:  (tag, message, meta) => write('warn',  tag, message, meta),
  error: (tag, message, meta) => write('error', tag, message, meta),
  LOG_DIR,
};
