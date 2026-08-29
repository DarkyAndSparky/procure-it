@echo off
title IT Assets - Install
echo.
echo  ============================================
echo   IT Assets - Installing dependencies...
echo  ============================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Please download from: https://nodejs.org
    echo  Choose the LTS version, install, then run this again.
    echo.
    pause
    exit /b 1
)

echo  Node.js found. Installing packages...
echo.

npm install

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Installation failed.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo   Done! Now run START.bat
echo  ============================================
echo.
pause
