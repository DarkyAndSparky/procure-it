@echo off
title IT Assets - E2E Tests (Playwright)
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

if not exist "node_modules\@playwright\test" (
    echo [INFO] Installing Playwright...
    call npm install
    echo.
)

if not exist "%USERPROFILE%\AppData\Local\ms-playwright" (
    echo [INFO] Downloading Chromium for Playwright ^(first run only^)...
    call npx playwright install chromium
    echo.
)

echo [RUN] Running E2E tests ^(this opens/runs a real browser^)...
echo ----------------------------------------

call node_modules\.bin\playwright.cmd test
set TEST_RESULT=%errorlevel%

echo ----------------------------------------
if %TEST_RESULT%==0 (
    echo [OK] All E2E tests passed.
) else (
    echo [FAIL] Some E2E tests failed. See test-results\ and playwright-report\ for details.
    echo [TIP] Run "npx playwright show-report" to view the HTML report.
)

cmd /k
