#!/usr/bin/env bash
# ============================================
#  IT Assets — запуск тестов
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Версия из package.json
APP_VER=$(node -e "try{process.stdout.write(require('./package.json').version)}catch(e){process.stdout.write('unknown')}" 2>/dev/null || echo "unknown")

echo ""
echo " ============================================"
echo "  IT Assets $APP_VER — Running tests..."
echo " ============================================"
echo ""

# Проверка Node.js
if ! command -v node &>/dev/null; then
    echo " [ERROR] Node.js не найден!"
    echo " Установите Node.js: https://nodejs.org"
    echo ""
    exit 1
fi

# Автоустановка зависимостей
if [ ! -d "node_modules" ]; then
    echo " [INFO] Устанавливаю зависимости..."
    echo ""
    npm install
    echo ""
fi

JEST_BIN="node_modules/.bin/jest"

if [ ! -f "$JEST_BIN" ]; then
    echo " [ERROR] jest не найден в node_modules."
    echo " Попробуйте: npm install"
    exit 1
fi

echo " [RUN] Запускаю тесты..."
echo " ----------------------------------------"
echo ""

set +e
"$JEST_BIN" --runInBand --forceExit --colors
TEST_RESULT=$?
set -e

echo ""
echo " ----------------------------------------"
if [ "$TEST_RESULT" -eq 0 ]; then
    echo " [OK] Все тесты прошли успешно."
else
    echo " [FAIL] Часть тестов завершилась с ошибками (код: $TEST_RESULT)."
fi
echo ""

exit "$TEST_RESULT"
