#!/usr/bin/env node
/**
 * scripts/sync-version.js
 *
 * INFRA-4: единственный источник правды по версии — файл VERSION в корне
 * репозитория (plain text, формат <alpha|beta>-N-YYwWW-NN). Раньше
 * источником был package.json.version — переехали на отдельный файл по
 * образцу соседнего проекта atlas-server: plain-text проще редактировать
 * руками, чем лезть внутрь JSON, и не требует валидного синтаксиса вокруг.
 *
 * Раскидывает версию по местам, где она дублируется как отображаемый текст:
 *   - package.json (версия пакета — для npm/консистентности с остальным
 *     инструментарием, которому нужен package.json.version)
 *   - README.md — бейдж версии (shields.io)
 *   - docs/index.html — версия в сайдбаре
 *
 * server/index.js и server/routes/settings.routes.js версию НЕ дублируют —
 * они читают VERSION напрямую в рантайме, синхронизировать там нечего.
 *
 * Запуск: node scripts/sync-version.js или npm run sync-version
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'VERSION');
const PKG_PATH     = path.join(ROOT, 'package.json');
const README_PATH  = path.join(ROOT, 'README.md');
const DOCS_PATH    = path.join(ROOT, 'docs', 'index.html');

const VERSION_RE = /^(alpha|beta)-(\d+)-(\d{2}w\d{2})-(\d+)$/;

function toDisplay(version) {
  const m = version.match(VERSION_RE);
  if (!m) return version; // неизвестный формат — отдаём как есть, не пытаемся угадать
  const [, stage, n, week, seq] = m;
  const stageChar = stage === 'alpha' ? 'α' : 'β';
  return `${stageChar}${n} · ${week}·${seq}`;
}

function updatePackageJson(version, content) {
  let pkg;
  try { pkg = JSON.parse(content); }
  catch (e) {
    console.warn('[sync-version] package.json: не удалось распарсить как JSON — пропускаю.');
    return { content, changed: false };
  }
  if (pkg.version === version) return { content, changed: false };
  pkg.version = version;
  return { content: JSON.stringify(pkg, null, 2) + '\n', changed: true };
}

function updateReadmeBadge(version, content) {
  // ![Version](.../версия-<текст>-blue?...)
  const re = /(!\[Version\]\(https:\/\/img\.shields\.io\/badge\/версия-)([^-]+(?:%C2%B7[^-]+)*)(-blue[^)]*\))/;
  if (!re.test(content)) {
    console.warn('[sync-version] README.md: бейдж версии не найден по ожидаемому паттерну — пропускаю.');
    return { content, changed: false };
  }
  const display = toDisplay(version).replace(/ /g, '');
  const next = content.replace(re, `$1${display}$3`);
  return { content: next, changed: next !== content };
}

function updateDocsVersion(version, content) {
  // <div class="version">...</div> в сайдбаре
  const re = /(<div class="version">)([^<]*)(<\/div>)/;
  if (!re.test(content)) {
    console.warn('[sync-version] docs/index.html: блок .version не найден — пропускаю.');
    return { content, changed: false };
  }
  const display = toDisplay(version);
  const next = content.replace(re, `$1${display}$3`);
  return { content: next, changed: next !== content };
}

function main() {
  if (!fs.existsSync(VERSION_FILE)) {
    console.error('[sync-version] Файл VERSION не найден в корне репозитория.');
    process.exit(1);
  }
  const version = fs.readFileSync(VERSION_FILE, 'utf8').trim();
  if (!version) {
    console.error('[sync-version] Файл VERSION пуст.');
    process.exit(1);
  }

  if (!VERSION_RE.test(version)) {
    console.warn(`[sync-version] Версия "${version}" не соответствует формату <alpha|beta>-N-YYwWW-NN — отображение может быть некорректным.`);
  }

  let anyChanged = false;

  if (fs.existsSync(PKG_PATH)) {
    const pkgRaw = fs.readFileSync(PKG_PATH, 'utf8');
    const { content, changed } = updatePackageJson(version, pkgRaw);
    if (changed) { fs.writeFileSync(PKG_PATH, content); console.log('[sync-version] package.json обновлён.'); anyChanged = true; }
  } else {
    console.warn('[sync-version] package.json не найден.');
  }

  if (fs.existsSync(README_PATH)) {
    const readme = fs.readFileSync(README_PATH, 'utf8');
    const { content, changed } = updateReadmeBadge(version, readme);
    if (changed) { fs.writeFileSync(README_PATH, content); console.log('[sync-version] README.md обновлён.'); anyChanged = true; }
  } else {
    console.warn('[sync-version] README.md не найден.');
  }

  if (fs.existsSync(DOCS_PATH)) {
    const docs = fs.readFileSync(DOCS_PATH, 'utf8');
    const { content, changed } = updateDocsVersion(version, docs);
    if (changed) { fs.writeFileSync(DOCS_PATH, content); console.log('[sync-version] docs/index.html обновлён.'); anyChanged = true; }
  } else {
    console.warn('[sync-version] docs/index.html не найден.');
  }

  console.log(`[sync-version] Текущая версия (из VERSION): ${version} (${toDisplay(version)})`);
  if (!anyChanged) console.log('[sync-version] Всё уже синхронизировано, изменений не потребовалось.');
}

main();
