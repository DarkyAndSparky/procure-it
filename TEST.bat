@echo off
title IT Assets - Tests
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    cmd /k
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    echo.
)

echo [RUN] Running tests...
echo ----------------------------------------

node_modules\.bin\jest.cmd --runInBand --forceExit --colors
set TEST_RESULT=%errorlevel%

echo ----------------------------------------
if %TEST_RESULT%==0 (
    echo [OK] All tests passed.
) else (
    echo [FAIL] Some tests failed.
)

cmd /k
