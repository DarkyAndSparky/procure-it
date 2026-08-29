@echo off
chcp 65001 >nul
title IT Assets - Server

echo.
echo  ============================================

set /p APP_VER=<VERSION 2>nul
if defined APP_VER (
    echo   IT Assets %APP_VER% - Starting server...
) else (
    echo   IT Assets - Starting server...
)

echo  ============================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Download from: https://nodejs.org
    pause
    exit /b 1
)

for /f "delims=" %%i in ('node scripts\check-deps-fresh.js 2^>nul') do set DEPS_STATUS=%%i
if "%DEPS_STATUS%"=="MISSING" (
    echo  First run - installing dependencies...
    echo  [Please don't close this window - this may take a minute]
    npm install
    echo.
) else if "%DEPS_STATUS%"=="STALE" (
    echo  package-lock.json changed since last install - updating dependencies...
    echo  [Please don't close this window - this may take a minute]
    npm install
    echo.
)

echo  HTTP  :3000  (redirect to HTTPS)
echo  HTTPS :3443  (main - open in browser)
echo.
echo  NOTE: Browser will warn about self-signed certificate.
echo  Click "Advanced" then "Proceed to localhost" to continue.
echo.
echo  To stop: press Ctrl+C
echo.

start "" /B cmd /C "timeout /t 4 >nul && start https://localhost:3443"

node server/index.js

pause
