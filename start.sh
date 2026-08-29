#!/usr/bin/env bash
# ============================================
#  IT Assets — запуск сервера
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Версия — единый источник правды теперь файл VERSION в корне (см. INFRA-4)
APP_VER=$(cat VERSION 2>/dev/null || echo "unknown")

echo ""
echo " ============================================"
echo "  IT Assets $APP_VER — Starting server..."
echo " ============================================"
echo ""

# Проверка Node.js
if ! command -v node &>/dev/null; then
    echo " [ERROR] Node.js не найден!"
    echo ""
    echo " Установите Node.js одним из способов:"
    echo "   Debian/Ubuntu:  sudo apt install nodejs npm"
    echo "   Fedora/RHEL:    sudo dnf install nodejs"
    echo "   Arch Linux:     sudo pacman -S nodejs npm"
    echo "   Через nvm:      https://github.com/nvm-sh/nvm"
    echo "   Официальный:    https://nodejs.org"
    echo ""
    exit 1
fi

NODE_VER=$(node --version)
echo " Node.js: $NODE_VER"

# Минимальная версия Node.js — 16
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 16 ]; then
    echo ""
    echo " [ERROR] Требуется Node.js 16 или новее (у вас: $NODE_VER)"
    echo " Обновите Node.js: https://nodejs.org"
    echo ""
    exit 1
fi

# Автоустановка/обновление зависимостей (INFRA-1: сравнение mtime
# package-lock.json и node_modules вместо голой проверки "папка есть/нет")
DEPS_STATUS=$(node scripts/check-deps-fresh.js 2>/dev/null || echo "STALE")
if [ "$DEPS_STATUS" = "MISSING" ]; then
    echo ""
    echo " [INFO] Первый запуск — устанавливаю зависимости..."
    echo " [Не закрывайте окно — это может занять минуту]"
    echo ""
    npm install
    echo ""
elif [ "$DEPS_STATUS" = "STALE" ]; then
    echo ""
    echo " [INFO] package-lock.json изменился — обновляю зависимости..."
    echo " [Не закрывайте окно — это может занять минуту]"
    echo ""
    npm install
    echo ""
fi

# Определяем локальный IP
LOCAL_IP=""
if command -v hostname &>/dev/null; then
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}') || true
fi

echo ""
echo " HTTP  :3000  (редирект на HTTPS)"
echo " HTTPS :3443  (основной)"
if [ -n "$LOCAL_IP" ]; then
    echo " Для коллег: https://$LOCAL_IP:3443"
fi
echo ""
echo " ВНИМАНИЕ: При первом открытии браузер покажет"
echo " предупреждение о сертификате — это нормально."
echo " Нажмите 'Подробности' -> 'Перейти на сайт' (Chrome)"
echo " или 'Принять риск и продолжить' (Firefox)."
echo ""
echo " Остановить: Ctrl+C"
echo ""

# Открыть браузер в фоне (с задержкой чтобы сервер успел стартовать)
if command -v xdg-open &>/dev/null; then
    (sleep 3 && xdg-open https://localhost:3443) &>/dev/null &
elif command -v open &>/dev/null; then
    (sleep 3 && open https://localhost:3443) &>/dev/null &
fi

node server/index.js
