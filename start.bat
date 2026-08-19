@echo off
chcp 65001 >nul
rem cd в собственную директорию скрипта — без этого call install.bat/npm
rem падают, если запустить не двойным кликом из проводника (а, например,
rem через ярлык с другим "Рабочая папка", или из Планировщика заданий),
rem когда текущая директория не совпадает с директорией скрипта.
cd /d "%~dp0"
title procure-it - Сервер
echo.
echo  ============================================
node -e "const p=require('./package.json');process.stdout.write('  procure-it v'+p.version+' - запуск сервера...\n')" 2>nul || echo   procure-it - запуск сервера...
echo  ============================================
echo.

rem Установка зависимостей и подготовка директорий (включая проверку
rem Node.js) вынесены в install.bat — он же используется отдельно, когда
rem нужно только подготовить окружение без запуска сервера.
call install.bat --from-start
if %errorlevel% neq 0 (
    pause
    exit /b 1
)

if defined PROCURE_PASSWORD (
    echo  [AUTH] Защита паролем: включена
) else (
    echo  [AUTH] Защита паролем: выключена
    echo  [AUTH] Чтобы включить: set PROCURE_PASSWORD=ваш_пароль
)
echo.
echo  HTTPS :9111  (основной)
echo  HTTP  :9112  (редирект на HTTPS)
echo.
echo  ВНИМАНИЕ: браузер предупредит о самоподписанном сертификате.
echo  Нажмите "Дополнительно", затем "Перейти на localhost".
echo.
echo  Для остановки: Ctrl+C
echo.

rem Уязвимость/находка (см. server.js): раньше браузер открывался по
rem фиксированному таймеру параллельно со стартом сервера — гонка. Теперь
rem сервер сам открывает браузер из колбэка listen(), когда РЕАЛЬНО готов
rem принимать соединения — никакой гонки. PROCURE_AUTO_OPEN=1 действует
rem только на этот процесс (не наследуется в Docker/systemd-запуски, где
rem node server.js вызывается без этой переменной).
set PROCURE_AUTO_OPEN=1
node server.js
pause
