@echo off
setlocal
cd /d "%~dp0"

echo === procure-it - E2E tests (Playwright) ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 18 or newer and run this file again.
  pause
  exit /b 1
)

node scripts\check-node-version.js
if errorlevel 1 (
  pause
  exit /b 1
)

rem E2E needs not only the runtime dependencies but also @playwright/test.
rem So we check both lock-file freshness and the dev dependency itself,
rem not just whether node_modules exists.
set "NEED_INSTALL=0"
node scripts\check-deps-fresh.js
if errorlevel 1 set "NEED_INSTALL=1"
if not exist "node_modules\@playwright\test" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" (
  echo Installing locked dependencies for E2E tests...
  echo THIS MAY TAKE A MINUTE OR TWO ^(especially the first time^) - DO NOT CLOSE THIS WINDOW,
  echo even if nothing seems to be happening.
  echo.
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. Check the message above.
    pause
    exit /b 1
  )
  echo.
)

rem Playwright's own installer is idempotent — it checks internally
rem whether the browser is already present and skips re-downloading it
rem (near-instant if so). Earlier this was a hand-rolled check for a
rem "chromium-*" folder under the Playwright cache — removed after it
rem produced a false "already installed" when only an unrelated cache
rem folder from a previous Playwright version happened to match the
rem prefix, silently skipping the real chromium_headless_shell install
rem (found 26w39 — E2E failed with "Executable doesn't exist" despite
rem this check saying browser was found). Playwright's own naming for
rem the browser folder has changed between versions before (chromium-N
rem vs chromium_headless_shell-N) — not worth re-guessing here.
echo Checking Playwright browser (Chromium)...
call npx playwright install chromium
if errorlevel 1 (
  echo Chromium installation failed. Check the message above.
  pause
  exit /b 1
)
echo.

echo Running the full E2E suite in Playwright...
echo.
call npm run test:e2e
if errorlevel 1 (
  echo.
  echo E2E tests failed. See details above.
  pause
  exit /b 1
)

echo.
echo E2E tests passed.
pause
