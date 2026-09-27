@echo off
setlocal
cd /d "%~dp0"

echo === procure-it - install ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found on this computer.
  echo Install Node.js version 18 or newer from https://nodejs.org
  echo then run install.bat again.
  pause
  exit /b 1
)

node scripts\check-node-version.js
if errorlevel 1 (
  echo Update Node.js at https://nodejs.org and run install.bat again.
  pause
  exit /b 1
)

set NEED_INSTALL=0
node scripts\check-deps-fresh.js
if errorlevel 1 set NEED_INSTALL=1

if %NEED_INSTALL%==0 (
  echo Dependencies are already installed and up to date.
)

if %NEED_INSTALL%==1 (
  echo Installing dependencies...
  echo THIS MAY TAKE A MINUTE OR TWO ^(especially the first time^) - DO NOT CLOSE THIS WINDOW,
  echo even if nothing seems to be happening.
  echo.
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Check the message above.
    echo Common causes: no internet access, a proxy blocking registry.npmjs.org,
    echo or a corrupted node_modules ^(deleting the node_modules folder
    echo and running install.bat again usually helps^).
    pause
    exit /b 1
  )
  echo.
  echo Dependencies installed.
)

if not exist data mkdir data
if not exist data\certs mkdir data\certs
if not exist data\backups mkdir data\backups
if not exist logs mkdir logs

echo.
echo Done! Now run start.bat to open the app.
pause
