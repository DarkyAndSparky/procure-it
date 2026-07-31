#!/bin/bash
set -e

cd "$(dirname "$0")"

echo ""
echo "══════════════════════════════════════════"
echo "  procure-it — Запуск сервера"
echo "══════════════════════════════════════════"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "[ОШИБКА] Node.js не установлен"
    echo "Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    echo "macOS: brew install node"
    echo "Или: https://nodejs.org/"
    exit 1
fi
echo "[OK] Node.js: $(node --version)"

# Install deps
if [ ! -d "node_modules/express" ]; then
    echo ""
    echo "[INFO] Устанавливаем зависимости..."
    npm install
    echo "[OK] Зависимости установлены"
fi

# Create dirs
mkdir -p data/certs data/backups logs

# Clean corrupt certs
if [ -f "data/certs/cert.pem" ]; then
    if ! grep -q "BEGIN CERTIFICATE" data/certs/cert.pem 2>/dev/null; then
        echo "[FIX] Удалён повреждённый сертификат"
        rm -f data/certs/cert.pem data/certs/key.pem
    fi
fi

echo ""
if [ -n "$PROCURE_PASSWORD" ]; then
    echo "[AUTH] Авторизация включена"
else
    echo "[AUTH] Выключена. Для пароля: export PROCURE_PASSWORD=yourpassword"
fi
echo ""
echo "[INFO] Сервер запускается на https://localhost:9111"
echo "[INFO] Ctrl+C для остановки"
echo ""

node server.js
