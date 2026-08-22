#!/bin/bash
# Только установка зависимостей и подготовка рабочих директорий — сервер не
# запускает. Для запуска после установки: ./start.sh (он тоже вызывает этот
# скрипт сам при первом запуске, так что отдельный шаг не обязателен —
# install.sh нужен, когда установку и запуск хочется развести: подготовить
# окружение заранее, под systemd-юнитом, в CI-шаге сборки и т.п.)
set -e

cd "$(dirname "$0")"

FROM_START=0
[ "$1" = "--from-start" ] && FROM_START=1

if [ "$FROM_START" -eq 0 ]; then
    echo ""
    echo "══════════════════════════════════════════"
    echo "  procure-it — Установка зависимостей"
    echo "══════════════════════════════════════════"
    echo ""
fi

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "[ОШИБКА] Node.js не установлен"
    echo "Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    echo "macOS: brew install node"
    echo "Или: https://nodejs.org/"
    exit 1
fi

# Минимальная версия Node.js — проверка вынесена в отдельный
# scripts/check-node-version.js (используется и .bat-версией на Windows;
# единая логика на обе платформы, не дублируем сравнение версий дважды).
if ! node scripts/check-node-version.js; then
    exit 1
fi

if ! command -v npm &>/dev/null; then
    echo "[ОШИБКА] npm не найден рядом с Node.js — переустановите Node.js с https://nodejs.org/"
    exit 1
fi

# Устанавливаем, если зависимостей ещё нет ИЛИ package-lock.json обновился
# после последней установки — проверка тоже в общем файле
# (scripts/check-deps-fresh.js), по той же причине: единая логика с .bat.
if ! node scripts/check-deps-fresh.js; then
    echo ""
    echo "[INFO] Устанавливаем зависимости..."
    if ! npm install; then
        echo ""
        echo "[ОШИБКА] npm install не завершился успешно (см. вывод выше)."
        echo "Частые причины: нет интернета / прокси блокирует registry.npmjs.org,"
        echo "либо повреждён node_modules — тогда помогает: rm -rf node_modules && ./install.sh"
        exit 1
    fi
    echo "[OK] Зависимости установлены"
else
    echo "[OK] Зависимости уже установлены и актуальны"
fi

# Create dirs
mkdir -p data/certs data/backups logs
echo "[OK] Рабочие директории готовы (data/, logs/)"

if [ "$FROM_START" -eq 0 ]; then
    echo ""
    echo "Готово. Для запуска сервера: ./start.sh"
    echo "Для прогона тестов: ./test.sh"
fi
