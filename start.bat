@echo off
setlocal
cd /d "%~dp0"

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
  echo Dependencies installed. Starting server...
  echo.
)

if not exist data mkdir data
if not exist data\certs mkdir data\certs
if not exist data\backups mkdir data\backups
if not exist logs mkdir logs

echo === procure-it ===
echo Starting server at https://localhost:9111
echo The browser will open automatically once the server is ready.
echo To stop the server - close this window or press Ctrl+C.
echo.

set PROCURE_AUTO_OPEN=1
node server.js
pause
