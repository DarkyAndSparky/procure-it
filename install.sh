#!/usr/bin/env bash
# ============================================
#  IT Assets — установка зависимостей
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Версия из package.json
APP_VER=$(node -e "try{process.stdout.write(require('./package.json').version)}catch(e){process.stdout.write('unknown')}" 2>/dev/null || echo "unknown")

echo ""
echo " ============================================"
echo "  IT Assets $APP_VER — Installing..."
echo " ============================================"
echo ""

# Проверка Node.js
if ! command -v node &>/dev/null; then
    echo " [ERROR] Node.js не найден!"
    echo ""
    echo " Установите Node.js одним из способов:"
    echo ""
    echo "   Debian / Ubuntu:"
    echo "     sudo apt update && sudo apt install nodejs npm"
    echo ""
    echo "   Fedora / RHEL / Rocky:"
    echo "     sudo dnf install nodejs"
    echo ""
    echo "   Arch Linux:"
    echo "     sudo pacman -S nodejs npm"
    echo ""
    echo "   nvm (рекомендуется — не требует sudo):"
    echo "     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    echo "     # затем перезапустите терминал и выполните:"
    echo "     nvm install --lts"
    echo ""
    echo "   Официальный сайт: https://nodejs.org"
    echo ""
    exit 1
fi

NODE_VER=$(node --version)
NPM_VER=$(npm --version)
echo " Node.js: $NODE_VER"
echo " npm:     $NPM_VER"
echo ""
echo " Устанавливаю пакеты..."
echo ""

npm install

echo ""
echo " ============================================"
echo "  Готово! Запустите: ./start.sh"
echo " ============================================"
echo ""
