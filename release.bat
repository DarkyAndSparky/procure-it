@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   RELEASE: dev ^→ main (clean build)
echo ========================================
echo.

:: Проверяем что мы в git репозитории
git status >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Запусти скрипт из папки проекта it-assets
    pause
    exit /b 1
)

:: Проверяем что мы на ветке dev
for /f "tokens=*" %%b in ('git branch --show-current') do set BRANCH=%%b
if not "%BRANCH%"=="dev" (
    echo [ОШИБКА] Ты не на ветке dev. Сейчас: %BRANCH%
    echo Сначала выполни: git checkout dev
    pause
    exit /b 1
)

:: Проверяем что нет незакоммиченных изменений
git diff --quiet
if errorlevel 1 (
    echo [ОШИБКА] Есть незакоммиченные изменения в dev!
    echo Сначала сделай: git add . ^&^& git commit -m "описание"
    pause
    exit /b 1
)

echo [1/5] Сохраняем текущий коммит dev...
for /f "tokens=*" %%c in ('git rev-parse --short HEAD') do set DEV_COMMIT=%%c
echo     dev commit: %DEV_COMMIT%

echo [2/5] Переключаемся на main...
git checkout main
if errorlevel 1 (
    echo [ОШИБКА] Не удалось переключиться на main
    pause
    exit /b 1
)

echo [3/5] Копируем файлы из dev (без тестов)...
git checkout dev -- server/
git checkout dev -- public/
git checkout dev -- START.bat
git checkout dev -- INSTALL.bat
git checkout dev -- start.sh
git checkout dev -- install.sh
git checkout dev -- LICENSE
git checkout dev -- README.md
git checkout dev -- .gitignore

echo [4/5] Обновляем package.json (без devDependencies)...
node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));delete pkg.devDependencies;pkg.scripts={start:'node server/index.js'};delete pkg.jest;fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');console.log('    package.json обновлён');"

echo [5/5] Коммит и пуш в main...
set RELEASE_MSG=main: release from dev@%DEV_COMMIT% [%DATE%]
git add .
git commit -m "%RELEASE_MSG%"
git push origin main

echo.
echo [OK] Возвращаемся на dev...
git checkout dev

echo.
echo ========================================
echo   ГОТОВО! main обновлён чистым билдом
echo ========================================
echo.
pause
