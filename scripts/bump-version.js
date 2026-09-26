#!/usr/bin/env node
/**
 * scripts/bump-version.js
 *
 * Вычисляет СЛЕДУЮЩУЮ версию по правилу:
 *   - если ISO год-неделя не изменились с текущей версии в package.json —
 *     номер сборки увеличивается на 1 (26w39-b01 → 26w39-b02);
 *   - если неделя сменилась (обычно ночь с воскресенья на понедельник) —
 *     номер сборки сбрасывается на 01, подставляется актуальная ISO-неделя
 *     (26w39-b07 → 26w40-b01).
 * Стадия (a/b/rc/r) наследуется из текущей версии, если не передан
 * `--stage=`; смена стадии тоже сбрасывает счётчик на 01 (переход
 * a → b, например, начинает нумерацию сборок стадии заново, а не
 * продолжает счётчик предыдущей).
 *
 * Пишет результат в package.json и сразу вызывает sync-version.js — тот
 * как был чисто пропагирующим, без обращения к дате (см. его шапку) —
 * иначе два прогона в разные дни без реального релиза давали бы разный
 * результат, что ломает воспроизводимость версии.
 *
 * Использование:
 *   npm run bump                  # тот же stage, авто week/counter
 *   npm run bump -- --stage=rc    # сменить стадию (счётчик → 01)
 *   npm run bump -- --dry-run     # только показать, что получится, не писать
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const VERSION_RE = /^(\d{2})w(\d{1,2})-(a|b|rc|r)(\d{2})$/;

// Классический ISO-8601 week-date алгоритм (через ближайший четверг) — год
// ISO-недели может отличаться от календарного года на стыке лет (см. тест
// ниже: 29 декабря 2025 — это уже неделя 1 2026-го). Наивное вычисление
// через getMonth()/getDate() эту границу ломает, поэтому только так.
function isoWeekYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Пн=0 ... Вс=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // ближайший четверг этой недели
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4)); // 4 января всегда в неделе 1
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day);
  const week = Math.round((d - week1Monday) / (7 * 24 * 3600 * 1000)) + 1;
  return { isoYear, week };
}

function computeNext(currentVersion, now, stageOverride) {
  const m = currentVersion.match(VERSION_RE);
  if (!m) {
    throw new Error(`Текущая версия "${currentVersion}" не соответствует формату YYwWW-{a|b|rc|r}NN`);
  }
  const [, curYY, curWeek, curStage, curBuild] = m;

  const { isoYear, week } = isoWeekYear(now);
  const yy = String(isoYear).slice(-2);
  const ww = String(week);
  const stage = stageOverride || curStage;
  if (!['a', 'b', 'rc', 'r'].includes(stage)) {
    throw new Error(`Неизвестная стадия "${stage}" — допустимо: a, b, rc, r`);
  }

  const sameWeek  = curYY === yy && curWeek === ww;
  const sameStage = stage === curStage;
  const nextBuild = (sameWeek && sameStage) ? String(parseInt(curBuild, 10) + 1).padStart(2, '0') : '01';

  return `${yy}w${ww}-${stage}${nextBuild}`;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const stageArg = process.argv.find(a => a.startsWith('--stage='));
  const stage = stageArg ? stageArg.split('=')[1] : null;

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const current = pkg.version;

  let next;
  try {
    next = computeNext(current, new Date(), stage);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  console.log(`${current} → ${next}`);
  if (dryRun) { console.log('(--dry-run: package.json не изменён)'); return; }

  pkg.version = next;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  execFileSync('node', [path.join(__dirname, 'sync-version.js')], { stdio: 'inherit', cwd: ROOT });
}

if (require.main === module) main();

module.exports = { computeNext, isoWeekYear };
