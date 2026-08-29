/**
 * scripts/check-deps-fresh.js
 *
 * INFRA-1: замена наивной проверки "существует ли node_modules" на
 * сравнение mtime package-lock.json и node_modules/.package-lock.json
 * (файл-снимок, который npm сам обновляет при каждой установке).
 *
 * Делается через Node, а не через START.bat/start.sh напрямую, потому что
 * сравнение дат в batch зависит от региональных настроек Windows —
 * "18.08.2026 9:51" на русской локали лексикографически не сравнить с
 * "08/18/2026 9:51 AM" на английской. Node даёт единообразный timestamp
 * независимо от локали.
 *
 * Печатает "STALE" (нужно npm install), "FRESH" (можно запускать) или
 * "MISSING" (node_modules нет вовсе) в stdout — вызывающий .bat/.sh сам
 * решает, что делать. Никогда не бросает исключение — при любой ошибке
 * считаем зависимости устаревшими (безопасный дефолт: лучше лишний раз
 * переустановить, чем стартовать со сломанными node_modules).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT           = path.join(__dirname, '..');
const LOCK_FILE       = path.join(ROOT, 'package-lock.json');
const NODE_MODULES    = path.join(ROOT, 'node_modules');
const SNAPSHOT_FILE   = path.join(NODE_MODULES, '.package-lock.json');

function main() {
  try {
    if (!fs.existsSync(NODE_MODULES)) {
      console.log('MISSING');
      return;
    }
    if (!fs.existsSync(LOCK_FILE)) {
      // Нет lock-файла вовсе — не можем сравнить, но node_modules есть,
      // так что считаем свежим (не наша забота чинить отсутствующий lock).
      console.log('FRESH');
      return;
    }
    // npm с версии 7 пишет снимок реально установленного дерева сюда при
    // каждом `npm install` — сравниваем его с package-lock.json проекта.
    const snapshotSrc = fs.existsSync(SNAPSHOT_FILE) ? SNAPSHOT_FILE : NODE_MODULES;
    const lockMtime     = fs.statSync(LOCK_FILE).mtimeMs;
    const installedMtime = fs.statSync(snapshotSrc).mtimeMs;

    console.log(installedMtime >= lockMtime ? 'FRESH' : 'STALE');
  } catch (e) {
    console.log('STALE');
  }
}

main();
