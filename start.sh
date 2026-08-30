#!/bin/bash
set -e

cd "$(dirname "$0")"

echo ""
echo "══════════════════════════════════════════"
echo "  procure-it — Запуск сервера"
echo "══════════════════════════════════════════"
echo ""

# Установка зависимостей и подготовка директорий вынесены в install.sh —
# он же используется отдельно, когда нужно только подготовить окружение
# без запуска сервера (systemd-юниты, шаги сборки и т.п.).
./install.sh --from-start

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
