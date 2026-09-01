@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo === procure-it - E2E-тесты (Playwright) ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 18 или новее и запустите файл снова.
  pause
  exit /b 1
)

node scripts\check-node-version.js
if errorlevel 1 (
  pause
  exit /b 1
)

rem E2E требует не только runtime-зависимости, но и @playwright/test.
rem Поэтому проверяем свежесть lock-файла и наличие dev-зависимости, а не
rem ограничиваемся существованием папки node_modules.
set "NEED_INSTALL=0"
node scripts\check-deps-fresh.js
if errorlevel 1 set "NEED_INSTALL=1"
if not exist "node_modules\@playwright\test" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" (
  echo Устанавливаю зафиксированные зависимости для E2E-тестов...
  echo ЭТО МОЖЕТ ЗАНЯТЬ МИНУТУ-ДВЕ ^(особенно первый раз^) — НЕ ЗАКРЫВАЙТЕ ОКНО,
  echo даже если кажется, что ничего не происходит.
  echo.
  call npm ci
  if errorlevel 1 (
    echo Установка зависимостей не удалась. Проверьте сообщение выше.
    pause
    exit /b 1
  )
  echo.
)

rem Браузер Chromium для Playwright не входит в npm install и качается
rem отдельно (~150-300MB) — проверяем, стоит ли он уже (по кэшу Playwright
rem в %USERPROFILE%\AppData\Local\ms-playwright), чтобы не тянуть заново
rem на каждый прогон.
set "PLAYWRIGHT_CACHE=%USERPROFILE%\AppData\Local\ms-playwright"
set "CHROMIUM_FOUND=0"
if exist "%PLAYWRIGHT_CACHE%" (
  for /d %%D in ("%PLAYWRIGHT_CACHE%\chromium-*") do set "CHROMIUM_FOUND=1"
)
if "%CHROMIUM_FOUND%"=="0" (
  echo Браузер Chromium для Playwright ещё не установлен. Устанавливаю...
  echo Это может занять несколько минут при первом запуске — не закрывайте окно.
  echo.
  call npx playwright install chromium
  if errorlevel 1 (
    echo Установка браузера Chromium не удалась. Проверьте сообщение выше.
    pause
    exit /b 1
  )
  echo.
)

echo Запускаю полный E2E-набор в Playwright...
echo.
call npm run test:e2e
if errorlevel 1 (
  echo.
  echo E2E-тесты завершились с ошибкой. Подробности указаны выше.
  pause
  exit /b 1
)

echo.
echo E2E-тесты успешно пройдены.
pause
