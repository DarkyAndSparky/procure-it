@echo off
chcp 65001 >nul
title procure-it - Server
echo.
echo  ============================================
node -e "const p=require('./package.json');process.stdout.write('  procure-it v'+p.version+' - Starting server...\n')" 2>nul || echo   procure-it - Starting server...
echo  ============================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Download from: https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo  First run - installing dependencies...
    npm install
    echo.
)

if not exist data mkdir data
if not exist data\certs mkdir data\certs
if not exist logs mkdir logs

if defined PROCURE_PASSWORD (
    echo  [AUTH] Password protection: enabled
) else (
    echo  [AUTH] Password protection: disabled
    echo  [AUTH] To enable: set PROCURE_PASSWORD=yourpassword
)
echo.
echo  HTTPS :9111  (main)
echo  HTTP  :9112  (redirect to HTTPS)
echo.
echo  NOTE: Browser will warn about self-signed certificate.
echo  Click Advanced then Proceed to localhost to continue.
echo.
echo  To stop: press Ctrl+C
echo.

start "" /B cmd /C "timeout /t 3 >nul && start https://localhost:9111"
node server.js
pause
