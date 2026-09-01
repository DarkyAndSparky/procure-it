@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo === procure-it - установка ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден на этом компьютере.
  echo Установите Node.js версии 18 или новее с https://nodejs.org
  echo и запустите install.bat снова.
  pause
  exit /b 1
)

node scripts\check-node-version.js
if errorlevel 1 (
  echo Обновите Node.js на https://nodejs.org и запустите install.bat снова.
  pause
  exit /b 1
)

set NEED_INSTALL=0
node scripts\check-deps-fresh.js
if errorlevel 1 set NEED_INSTALL=1

if %NEED_INSTALL%==0 (
  echo Зависимости уже установлены и актуальны.
)

if %NEED_INSTALL%==1 (
  echo Устанавливаю зависимости...
  echo ЭТО МОЖЕТ ЗАНЯТЬ МИНУТУ-ДВЕ ^(особенно первый раз^) — НЕ ЗАКРЫВАЙТЕ ОКНО,
  echo даже если кажется, что ничего не происходит.
  echo.
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей не удалась. Проверьте сообщение выше.
    echo Частые причины: нет интернета, прокси блокирует registry.npmjs.org,
    echo либо повреждён node_modules ^(тогда помогает: удалить папку node_modules
    echo и запустить install.bat снова^).
    pause
    exit /b 1
  )
  echo.
  echo Зависимости установлены.
)

if not exist data mkdir data
if not exist data\certs mkdir data\certs
if not exist data\backups mkdir data\backups
if not exist logs mkdir logs

echo.
echo Готово! Теперь запустите start.bat, чтобы открыть сайт.
pause
