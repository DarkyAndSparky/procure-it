/**
 * scripts/install-hooks.js
 *
 * INFRA-3: устанавливает scripts/hooks/pre-commit в .git/hooks/pre-commit.
 * Запускается автоматически через "prepare" в package.json при каждом
 * `npm install` — то есть хук переустанавливается заново на каждой
 * машине, где кто-то делает npm install, а не хранится в самом .git/
 * (папка .git/hooks не коммитится вместе с репозиторием).
 *
 * Тихо завершается без ошибки, если это не git-репозиторий (например,
 * проект распакован из zip без .git) — установка хуков не должна ронять
 * npm install у тех, кто просто скачал архив.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const GIT_DIR    = path.join(ROOT, '.git');
const HOOKS_SRC  = path.join(ROOT, 'scripts', 'hooks', 'pre-commit');
const HOOKS_DEST = path.join(GIT_DIR, 'hooks', 'pre-commit');

function main() {
  if (!fs.existsSync(GIT_DIR)) {
    // Не git-репозиторий (распакованный zip и т.п.) — ставить некуда, это ок.
    return;
  }
  if (!fs.existsSync(HOOKS_SRC)) {
    console.warn('[install-hooks] scripts/hooks/pre-commit не найден, пропускаю установку.');
    return;
  }

  try {
    const hooksDir = path.join(GIT_DIR, 'hooks');
    if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

    let content = fs.readFileSync(HOOKS_SRC, 'utf8');
    // Нормализация переводов строк — критично для Windows (Git for Windows
    // запускает хуки через свой bash, но текстовые редакторы/git на Windows
    // иногда добавляют CRLF при копировании; #!/bin/sh с CRLF после shebang
    // ломается на некоторых системах).
    content = content.replace(/\r\n/g, '\n');

    fs.writeFileSync(HOOKS_DEST, content, { mode: 0o755 });
    try { fs.chmodSync(HOOKS_DEST, 0o755); } catch (e) { /* Windows — не критично */ }

    console.log('[install-hooks] pre-commit хук установлен.');
  } catch (e) {
    // Установка хука — не то, из-за чего должен падать npm install.
    console.warn('[install-hooks] Не удалось установить хук:', e.message);
  }
}

main();
