#!/usr/bin/env bash
# ============================================
#  IT Assets — запуск E2E-тестов (Playwright)
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Версия из package.json
APP_VER=$(node -e "try{process.stdout.write(require('./package.json').version)}catch(e){process.stdout.write('unknown')}" 2>/dev/null || echo "unknown")

echo ""
echo " ============================================"
echo "  IT Assets $APP_VER — Running E2E tests..."
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

if [ ! -d "node_modules/@playwright/test" ]; then
    echo " [INFO] Устанавливаю Playwright..."
    echo ""
    npm install
    echo ""
fi

# Проверка, скачан ли браузер (первый запуск)
if [ ! -d "$HOME/.cache/ms-playwright" ]; then
    echo " [INFO] Скачиваю Chromium для Playwright (только при первом запуске)..."
    echo ""
    npx playwright install chromium
    echo ""
fi

PLAYWRIGHT_BIN="node_modules/.bin/playwright"

if [ ! -f "$PLAYWRIGHT_BIN" ]; then
    echo " [ERROR] playwright не найден в node_modules."
    echo " Попробуйте: npm install"
    exit 1
fi

echo " [RUN] Запускаю E2E-тесты (реальный браузер)..."
echo " ----------------------------------------"
echo ""

set +e
"$PLAYWRIGHT_BIN" test
TEST_RESULT=$?
set -e

echo ""
echo " ----------------------------------------"
if [ "$TEST_RESULT" -eq 0 ]; then
    echo " [OK] Все E2E-тесты прошли успешно."
else
    echo " [FAIL] Часть E2E-тестов завершилась с ошибками (код: $TEST_RESULT)."
    echo " [TIP] Смотрите test-results/ и playwright-report/, либо:"
    echo "       npx playwright show-report"
fi
echo ""

exit "$TEST_RESULT"
