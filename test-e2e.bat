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

rem Playwright's Chromium browser is not part of npm install and is
rem downloaded separately (~150-300MB) - check whether it is already
rem installed (via the Playwright cache under
rem %USERPROFILE%\AppData\Local\ms-playwright) so we do not re-download
rem it on every run.
set "PLAYWRIGHT_CACHE=%USERPROFILE%\AppData\Local\ms-playwright"
set "CHROMIUM_FOUND=0"
if exist "%PLAYWRIGHT_CACHE%" (
  for /d %%D in ("%PLAYWRIGHT_CACHE%\chromium-*") do set "CHROMIUM_FOUND=1"
)
if "%CHROMIUM_FOUND%"=="0" (
  echo Playwright's Chromium browser is not installed yet. Installing...
  echo This may take a few minutes the first time - do not close this window.
  echo.
  call npx playwright install chromium
  if errorlevel 1 (
    echo Chromium installation failed. Check the message above.
    pause
    exit /b 1
  )
  echo.
)

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
