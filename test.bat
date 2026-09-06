@echo off
setlocal
cd /d "%~dp0"

echo === procure-it - tests ===
echo.

if not exist node_modules (
  echo Dependencies not installed yet. Installing now...
  echo THIS MAY TAKE A MINUTE OR TWO ^(especially the first time^) - DO NOT CLOSE THIS WINDOW,
  echo even if nothing seems to be happening.
  echo.
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Check the message above.
    pause
    exit /b 1
  )
  echo.
)

call npm test
pause
