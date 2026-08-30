// Парсит CHANGELOG.md (формат Keep a Changelog) для раздела «Последние
// изменения» на странице «О системе». CHANGELOG.md — единственный источник
// истины; здесь НЕТ дублирующего списка изменений вручную (именно дублирование
// такого рода уже приводило к рассинхрону — см. историю с формулой цены,
// вынесенной в pricing-core.js).
const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');

// Возвращает [{ version, date, items: [строка, ...] }, ...], последние сверху.
// Берём последние `limit` релизов, чтобы не тащить в API весь файл целиком.
function parseChangelog(limit = 5) {
  let text;
  try {
    text = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  } catch(e) {
    return [];
  }

  const releases = [];
  // Разбиваем по заголовкам вида "## [версия] — дата"
  const headerRe = /^##\s*\[([^\]]+)\]\s*—\s*(\d{4}-\d{2}-\d{2})\s*$/gm;
  const matches = [...text.matchAll(headerRe)];

  for (let i = 0; i < matches.length && releases.length < limit; i++) {
    const [, version, date] = matches[i];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end);

    // Собираем пункты списка (строки "- ...") из всех подразделов
    // (### Добавлено / Изменено / Исправлено) в один плоский список —
    // для компактной сводки в UI подзаголовки не нужны, полный markdown
    // с разбивкой по категориям всегда доступен в самом CHANGELOG.md.
    const items = [...body.matchAll(/^- (.+)$/gm)].map(m => m[1].trim());

    releases.push({ version, date, items });
  }

  return releases;
}

module.exports = parseChangelog();
