#!/bin/bash
# Прогон e2e-тестов (Playwright). Отдельно от test.sh намеренно — e2e
# требует установленный браузер Chromium (не входит в npm install) и
# реально поднимает сервер на изолированной БД (см. playwright.config.js:
# PROCURE_DATA_DIR/webServer), это тяжелее и медленнее обычных unit-тестов
# из test.sh, поэтому держим их отдельными командами, а не одной общей.
set -e

cd "$(dirname "$0")"

echo ""
echo "══════════════════════════════════════════"
echo "  procure-it — E2E-тесты (Playwright)"
echo "══════════════════════════════════════════"
echo ""

# Зависимости и рабочие директории — та же логика, что для сервера/unit-
# тестов, переиспользуем install.sh вместо третьей копии проверок.
./install.sh --from-start

# install.sh проверяет базовую runtime-зависимость Express. Для E2E этого
# недостаточно: production-установка (`npm ci --omit=dev`) может быть свежей,
# но не содержать @playwright/test. В таком случае ставим полный, строго
# зафиксированный по package-lock.json набор прежде чем запускать тесты.
if [ ! -d "node_modules/@playwright/test" ]; then
  echo "[INFO] Устанавливаю зафиксированные dev-зависимости для E2E-тестов..."
  npm ci
fi

# Браузер Chromium для Playwright не входит в npm install и качается
# отдельно (~150-300MB) — проверяем, стоит ли он уже (по кэшу Playwright),
# чтобы не тянуть заново на каждый прогон.
if [ ! -d "$HOME/.cache/ms-playwright" ] || [ -z "$(find "$HOME/.cache/ms-playwright" -maxdepth 1 -iname 'chromium-*' -print -quit 2>/dev/null)" ]; then
  echo "[INFO] Браузер Chromium для Playwright ещё не установлен. Устанавливаю..."
  echo "Это может занять несколько минут при первом запуске — не закрывайте окно."
  echo ""
  npx playwright install chromium
  echo ""
fi

npm run test:e2e
