@echo off
chcp 65001 >nul
rem cd в собственную директорию — см. пояснение в start.bat: без этого
rem npm install/mkdir выполняются не в той папке, если скрипт запущен не
rem прямым двойным кликом (ярлык с другим "Рабочая папка" и т.п.).
cd /d "%~dp0"
rem Только установка зависимостей и подготовка рабочих директорий — сервер
rem не запускает. start.bat тоже вызывает этот скрипт сам при первом
rem запуске, так что отдельный шаг не обязателен — install.bat нужен, когда
rem установку и запуск хочется развести (подготовить окружение заранее и т.п.)

if "%~1"=="--from-start" (
    set FROM_START=1
) else (
    set FROM_START=0
    title procure-it - Установка
    echo.
    echo  ============================================
    echo   procure-it - Установка зависимостей
    echo  ============================================
    echo.
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ОШИБКА] Node.js не найден!
    echo  Скачать: https://nodejs.org
    if "%FROM_START%"=="0" pause
    exit /b 1
)

rem Минимальная версия Node.js — сравнение делегировано самому Node
rem (process.versions), а не написано в batch: числовые сравнения в
rem cmd.exe возможны, но дата/строковые операции в batch зависят от
rem региональных настроек Windows (см. ниже про node_modules) — раз уж
rem всё равно вызываем node, надёжнее спросить сам интерпретатор, а не
rem разбирать версию руками.
node -e "const min=parseInt(require('./package.json').engines.node.match(/\d+/)[0],10);const cur=parseInt(process.versions.node.split('.')[0],10);if(cur<min){console.error('  [ОШИБКА] Node.js '+process.version+' слишком старый — нужен '+min+'.x или новее');process.exit(1)}"
if %errorlevel% neq 0 (
    if "%FROM_START%"=="0" pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo  [OK] Node.js: %%v

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ОШИБКА] npm не найден рядом с Node.js - переустановите Node.js с https://nodejs.org
    if "%FROM_START%"=="0" pause
    exit /b 1
)

rem Устанавливаем, если зависимостей ещё нет ИЛИ package-lock.json обновился
rem после последней установки. Сравнение дат — тоже через Node
rem (fs.statSync().mtimeMs), а НЕ через %~tA: формат даты в batch зависит
rem от региональных настроек Windows ("18.08.2026 9:51" на русской локали
rem против "08/18/2026 9:51 AM" на английской) — лексикографически такие
rem строки сравнивать напрямую нельзя, а парсить надёжно в чистом batch
rem не стоит того, когда под рукой уже есть Node с locale-независимым Date.
set NEED_INSTALL=0
if not exist node_modules\express set NEED_INSTALL=1
if %NEED_INSTALL%==0 (
    node -e "const fs=require('fs');process.exit(fs.statSync('package-lock.json').mtimeMs>fs.statSync('node_modules').mtimeMs?1:0)" 2>nul
    if %errorlevel% neq 0 set NEED_INSTALL=1
)

if %NEED_INSTALL%==1 (
    echo  Устанавливаем зависимости...
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo  [ОШИБКА] npm install завершился с ошибкой - см. вывод выше.
        echo  Частые причины: нет интернета / прокси блокирует registry.npmjs.org,
        echo  либо повреждён node_modules - тогда помогает: rmdir /s /q node_modules ^&^& install.bat
        if "%FROM_START%"=="0" pause
        exit /b 1
    )
    echo  [OK] Зависимости установлены
) else (
    echo  [OK] Зависимости уже установлены и актуальны
)

if not exist data mkdir data
if not exist data\certs mkdir data\certs
if not exist data\backups mkdir data\backups
if not exist logs mkdir logs
echo  [OK] Рабочие директории готовы

if "%FROM_START%"=="0" (
    echo.
    echo  Готово. Для запуска сервера: start.bat
    echo  Для прогона тестов: test.bat
    pause
)
