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

# Минимальная версия — из package.json (engines.node), не дублируем число
# руками, чтобы два места не разъехались при следующем обновлении.
MIN_NODE_MAJOR=$(node -e "console.log(require('./package.json').engines.node.match(/\d+/)[0])" 2>/dev/null || echo 18)
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
    echo "[ОШИБКА] Node.js $(node --version) слишком старый — нужен $MIN_NODE_MAJOR.x или новее"
    echo "Обновление — теми же командами, что и установка (см. выше)"
    exit 1
fi
echo "[OK] Node.js: $(node --version)"

if ! command -v npm &>/dev/null; then
    echo "[ОШИБКА] npm не найден рядом с Node.js — переустановите Node.js с https://nodejs.org/"
    exit 1
fi

# Устанавливаем, если зависимостей ещё нет ИЛИ package-lock.json обновился
# после последней установки (например, добавили новый пакет в package.json
# и запустили npm install у себя, а тут разворачиваете начисто) — иначе
# легко словить «работало на другой машине»: express есть, а какой-то
# недавно добавленный пакет — нет, и это не всегда сразу заметно.
NEED_INSTALL=0
[ ! -d "node_modules/express" ] && NEED_INSTALL=1
[ -f "package-lock.json" ] && [ "package-lock.json" -nt "node_modules" ] && NEED_INSTALL=1

if [ "$NEED_INSTALL" -eq 1 ]; then
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
