#!/usr/bin/env node
/**
 * scripts/sync-version.js
 *
 * package.json → "version" — единственный источник правды для номера версии
 * во всём проекте. Этот скрипт подставляет его во все остальные места, где
 * версия отображается человеку, чтобы их не приходилось (и не забывалось)
 * править руками при каждом релизе.
 *
 * Формат версии: YYwWW-СТАДИЯNN
 *   YY      — год, 2 цифры                      (26)
 *   wWW     — ISO-номер недели                   (w31)
 *   СТАДИЯ  — a (alpha) | b (beta) | rc | r (release)
 *   NN      — порядковый номер сборки на неделе  (01)
 * Примеры: 26w31-b01, 26w31-rc01, 26w31-r01, 26w32-a01
 *
 * Куда подставляется:
 *   - README.md               — бейдж версии (shields.io, "-" экранируется как "--")
 *   - docs/index.html         — версия в шапке, hero-бейдж, футер
 *   - public/zakupki.html     — не трогаем: там версия подтягивается live через
 *                               fetch('/api/version') на клиенте (см. public/js/config.js)
 *   - docker-compose.yml      — тег Docker-образа (image: procure-it:X)
 *   - Dockerfile              — LABEL org.opencontainers.image.version
 *
 * Как использовать: поменяли package.json → version, затем
 *   npm run version:sync
 * Иллюстративные примеры формата (в разделах "Версионирование" докой/README)
 * скрипт НЕ трогает — только реальные плейсхолдеры "текущая версия",
 * помеченные <!--VERSION-->…<!--/VERSION--> / <!--VERSION_SHIELDS-->…<!--/VERSION_SHIELDS-->.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const VERSION_FORMAT = /^\d{2}w\d{1,2}-(a|b|rc|r)\d{2}$/;

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;

  if (!VERSION_FORMAT.test(version)) {
    console.error(`✗ package.json version "${version}" не соответствует формату YYwWW-{a|b|rc|r}NN (пример: 26w31-b01)`);
    process.exit(1);
  }

  let changedFiles = 0;

  changedFiles += syncMarked(path.join(ROOT, 'README.md'), version);
  changedFiles += syncMarked(path.join(ROOT, 'docs', 'index.html'), version);
  changedFiles += syncDockerCompose(path.join(ROOT, 'docker-compose.yml'), version);
  changedFiles += syncDockerfile(path.join(ROOT, 'Dockerfile'), version);

  console.log(`\n✓ Версия ${version} синхронизирована. Файлов изменено: ${changedFiles}.`);
  if (changedFiles === 0) {
    console.log('  (все места уже были в актуальном состоянии)');
  }
}

// Заменяет содержимое между <!--VERSION-->…<!--/VERSION--> и
// <!--VERSION_SHIELDS-->…<!--/VERSION_SHIELDS--> (последний — с "-" → "--"
// для корректного отображения в бейдже shields.io) на текущую версию.
function syncMarked(filePath, version) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ Файл не найден, пропущен: ${path.relative(ROOT, filePath)}`);
    return 0;
  }
  const original = fs.readFileSync(filePath, 'utf8');
  let updated = original;

  updated = updated.replace(
    /<!--VERSION-->[\s\S]*?<!--\/VERSION-->/g,
    `<!--VERSION-->${version}<!--/VERSION-->`
  );
  updated = updated.replace(
    /<!--VERSION_SHIELDS-->[\s\S]*?<!--\/VERSION_SHIELDS-->/g,
    `<!--VERSION_SHIELDS-->${version.replace(/-/g, '--')}<!--/VERSION_SHIELDS-->`
  );

  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
    return 1;
  }
  return 0;
}

// docker-compose.yml — не HTML, маркеры-комментарии там неуместны (не валидный
// YAML), поэтому матчим саму строку с тегом образа напрямую.
function syncDockerCompose(filePath, version) {
  if (!fs.existsSync(filePath)) return 0;
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = original.replace(
    /image: procure-it:[^\s]+/,
    `image: procure-it:${version}`
  );
  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
    return 1;
  }
  return 0;
}

// Dockerfile — LABEL org.opencontainers.image.version. Раньше правился
// руками при каждом бампе версии (пункт из ROADMAP.md backlog) — легко
// забыть, что и происходило: несколько релизов подряд эта строка не
// синхронизировалась автоматически, только вручную теми же руками, что
// правили package.json.
function syncDockerfile(filePath, version) {
  if (!fs.existsSync(filePath)) return 0;
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = original.replace(
    /org\.opencontainers\.image\.version="[^"]*"/,
    `org.opencontainers.image.version="${version}"`
  );
  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
    return 1;
  }
  return 0;
}

main();
