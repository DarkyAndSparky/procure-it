#!/usr/bin/env node
// Определяет, нужно ли переустанавливать зависимости: их ещё нет вообще,
// либо package-lock.json обновился после последней установки. Код возврата
// 1 — нужна установка, 0 — не нужна.
//
// Отдельный файл по той же причине, что и check-node-version.js — не
// inline `node -e` внутри .bat (см. его комментарий). Сравнение времени
// изменения — через fs.statSync().mtimeMs, а НЕ через %~tA в чистом
// batch: формат даты там зависит от региональных настроек Windows
// ("18.08.2026 9:51" на русской локали против "08/18/2026 9:51 AM" на
// английской) — лексикографически такие строки сравнивать напрямую
// нельзя. Node здесь даёт locale-независимое сравнение бесплатно.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nodeModulesExpress = path.join(root, 'node_modules', 'express');
const lockFile = path.join(root, 'package-lock.json');
const nodeModulesDir = path.join(root, 'node_modules');

if (!fs.existsSync(nodeModulesExpress)) {
  process.exit(1); // зависимостей ещё нет вообще
}

try {
  const lockTime = fs.statSync(lockFile).mtimeMs;
  const modulesTime = fs.statSync(nodeModulesDir).mtimeMs;
  process.exit(lockTime > modulesTime ? 1 : 0);
} catch (e) {
  process.exit(1); // на сомнение — переустановить, это дёшево, если и так всё свежее
}
