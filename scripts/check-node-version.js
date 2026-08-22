#!/usr/bin/env node
// Проверяет установленную версию Node.js против engines.node из package.json.
//
// Намеренно отдельный файл, а не `node -e "..."` прямо внутри install.bat/
// install.sh: длинный JS-однострочник (фигурные/круглые скобки, кавычки,
// точки с запятой) вперемешку с кириллицей на той же строке оказался
// хрупким местом для парсера cmd.exe на реальной Windows — сборка 26w34-b01
// ломалась именно на таких строках (см. CHANGELOG.md/ROADMAP.md). Здесь же
// вызов из .bat/.sh — это просто `node scripts\check-node-version.js`,
// без единого спецсимвола на самой строке .bat-файла; вся сложная логика и
// кириллица в сообщениях — внутри обычного .js-файла, который дальше
// парсит уже сам Node, а не cmd.exe.
const path = require('path');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const minStr = (pkg.engines && pkg.engines.node) || '>=18.0.0';
const min = parseInt(minStr.match(/\d+/)?.[0] || '18', 10);
const cur = parseInt(process.versions.node.split('.')[0], 10);

if (cur < min) {
  console.error(`[ОШИБКА] Node.js ${process.version} слишком старый — нужен ${min}.x или новее`);
  process.exit(1);
}

console.log(`[OK] Node.js: ${process.version}`);
