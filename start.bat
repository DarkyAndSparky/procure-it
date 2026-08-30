@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

if not exist node_modules (
  echo Зависимости ещё не установлены. Устанавливаю сейчас...
  echo ЭТО МОЖЕТ ЗАНЯТЬ МИНУТУ-ДВЕ ^(особенно первый раз^) — НЕ ЗАКРЫВАЙТЕ ОКНО,
  echo даже если кажется, что ничего не происходит.
  echo.
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей не удалась. Проверьте сообщение выше.
    pause
    exit /b 1
  )
  echo.
  echo Зависимости установлены. Запускаю сервер...
  echo.
)

if not exist data mkdir data
if not exist data\certs mkdir data\certs
if not exist data\backups mkdir data\backups
if not exist logs mkdir logs

echo === procure-it ===
echo Запускаю сервер на https://localhost:9111
echo Браузер откроется автоматически, как только сервер будет готов принимать запросы.
echo Чтобы остановить сервер — закройте это окно или нажмите Ctrl+C.
echo.

set PROCURE_AUTO_OPEN=1
node server.js
pause
