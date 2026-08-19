@echo off
chcp 65001 >nul
rem cd в собственную директорию — та же причина, что в install.bat/start.bat.
cd /d "%~dp0"
rem Прогон автотестов. Отдельно от start.bat/install.bat намеренно — тесты
rem не нужны в прод-окружении (Docker-образ их и не копирует), это чисто
rem dev-инструмент.
title procure-it - Тесты
echo.
echo  ============================================
echo   procure-it - Тесты
echo  ============================================
echo.

rem Проверка версии Node.js, установка зависимостей (и их актуальности) —
rem та же логика, что и для запуска сервера, переиспользуем install.bat
rem вместо третьей копии одних и тех же проверок (--from-start подавляет
rem его собственный баннер/финальную подсказку).
call install.bat --from-start
if %errorlevel% neq 0 (
    pause
    exit /b 1
)

call npm test
pause
