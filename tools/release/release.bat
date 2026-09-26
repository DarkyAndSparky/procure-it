@echo off
chcp 65001 >nul
setlocal

rem === Self-relocate to a temp copy before doing anything else ===
rem Why: this script lives in tools\release\, and tools\ is exactly what
rem step [6/9] strips from `main`. Step [4/9] below runs `git checkout
rem main`, which swaps the ENTIRE working tree to main's — including
rem deleting tools\release\release.bat, i.e. the very file cmd.exe is
rem reading line-by-line right now. cmd.exe re-reads .bat files from disk
rem as it executes (not buffered fully in memory), so the file vanishing
rem mid-run aborts with "The system cannot find the path specified"
rem right after the checkout (found live on a real release attempt,
rem 26w39-r01 — merge never even ran, caught early, no data lost, but
rem cost a manual recovery). Fix: copy this whole folder to %TEMP% once,
rem then re-invoke the COPY with the same arguments — that copy lives
rem outside the git working tree, so branch switches can't touch it.
if "%PROCURE_RELEASE_RELOCATED%"=="1" goto :relocated
set "PROCURE_RELEASE_RELOCATED=1"
set "RELOC_DIR=%TEMP%\procure-release-%RANDOM%%RANDOM%"
mkdir "%RELOC_DIR%" >nul 2>&1
xcopy "%~dp0*" "%RELOC_DIR%\" /e /i /q >nul
if errorlevel 1 (
    echo ERROR: could not copy release scripts to a temp folder ^(%RELOC_DIR%^)
    exit /b 1
)
call "%RELOC_DIR%\release.bat" %*
set "RC=%errorlevel%"
rmdir /s /q "%RELOC_DIR%" >nul 2>&1
exit /b %RC%
:relocated

set "NEW_VER=%~1"
if "%NEW_VER%"=="" (
    echo ERROR: specify version. Example: release.bat 26w35-r01
    exit /b 1
)

node "%~dp0release-validate.js" "%NEW_VER%"
if errorlevel 1 exit /b 1

for /f "tokens=*" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i NOT "%BRANCH%"=="dev" (
    echo ERROR: current branch is "%BRANCH%", must be "dev"
    exit /b 1
)

git diff --quiet 2>nul && git diff --cached --quiet 2>nul
if errorlevel 1 (
    echo ERROR: uncommitted changes exist. Commit or stash them.
    exit /b 1
)

echo.
echo === procure-it release ===
echo Version: %NEW_VER%
echo.

echo [1/9] package.json ...
node "%~dp0release-bump.js" "%NEW_VER%"
if errorlevel 1 ( echo ERROR: package.json & exit /b 1 )

echo [1b/9] sync package-lock.json version field ...
rem release-bump.js only updates the version in package.json - without this
rem step package-lock.json keeps the old version number in its top-level
rem "version" field (bug found while reviewing this script: git add below
rem would commit package-lock.json with a version that does not match
rem package.json).
rem --package-lock-only does not touch node_modules - fast, no full install.
call npm install --package-lock-only
if errorlevel 1 ( echo ERROR: package-lock.json sync & exit /b 1 )

echo [2/9] npm run version:sync ...
call npm run version:sync
if errorlevel 1 ( echo ERROR: version:sync & exit /b 1 )

echo [3/9] git commit bump in dev ...
git add package.json package-lock.json README.md docs/index.html Dockerfile docker-compose.yml 2>nul
git commit -m "chore: bump version to %NEW_VER%"
if errorlevel 1 ( echo ERROR: git commit & exit /b 1 )

echo [4/9] git checkout main ...
git checkout main
if errorlevel 1 ( echo ERROR: checkout main & exit /b 1 )

echo [5/9] git merge dev --no-ff ...
git merge dev --no-ff -m "release: v%NEW_VER%"
if errorlevel 1 (
    echo ERROR: merge conflict. Resolve manually.
    exit /b 1
)

echo [6/9] removing dev-only files from main ...
git rm -r --cached --ignore-unmatch test/              >nul 2>&1
git rm -r --cached --ignore-unmatch e2e/               >nul 2>&1
git rm -r --cached --ignore-unmatch tools/             >nul 2>&1
git rm    --cached --ignore-unmatch playwright.config.js >nul 2>&1
git rm    --cached --ignore-unmatch test.bat           >nul 2>&1
git rm    --cached --ignore-unmatch test.sh            >nul 2>&1
git rm    --cached --ignore-unmatch test-e2e.bat       >nul 2>&1
git rm    --cached --ignore-unmatch test-e2e.sh        >nul 2>&1
git rm    --cached --ignore-unmatch CONTRIBUTING.md    >nul 2>&1
git rm    --cached --ignore-unmatch ROADMAP.md         >nul 2>&1
git rm    --cached --ignore-unmatch ROADMAP_Q4.md        >nul 2>&1
git rm    --cached --ignore-unmatch ROADMAP_MIGRATION.md >nul 2>&1
git rm    --cached --ignore-unmatch AI_CONTEXT.md        >nul 2>&1

if exist test\           rmdir /s /q test
if exist e2e\            rmdir /s /q e2e
if exist tools\          rmdir /s /q tools
if exist playwright.config.js  del /q playwright.config.js
if exist test.bat        del /q test.bat
if exist test.sh         del /q test.sh
if exist test-e2e.bat    del /q test-e2e.bat
if exist test-e2e.sh     del /q test-e2e.sh
if exist CONTRIBUTING.md del /q CONTRIBUTING.md
if exist ROADMAP.md      del /q ROADMAP.md
if exist ROADMAP_Q4.md        del /q ROADMAP_Q4.md
if exist ROADMAP_MIGRATION.md del /q ROADMAP_MIGRATION.md
if exist AI_CONTEXT.md        del /q AI_CONTEXT.md
echo   done.

echo [7/9] git commit strip ...
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: strip dev-only files for release"
) else (
    echo   nothing to commit, ok.
)

echo [8/9] git tag v%NEW_VER% ...
git tag "v%NEW_VER%"
if errorlevel 1 ( echo ERROR: git tag & exit /b 1 )

echo [9/9] push main + tag, back to dev ...
git push origin main --tags
if errorlevel 1 ( echo ERROR: push main & exit /b 1 )

git checkout dev
if errorlevel 1 ( echo ERROR: checkout dev & exit /b 1 )

git push origin dev
if errorlevel 1 ( echo ERROR: push dev & exit /b 1 )

echo.
echo ====================================================
echo  DONE! Release v%NEW_VER% published in main.
echo  https://github.com/DarkyAndSparky/procure-it/releases/new
echo  Tag: v%NEW_VER%
echo ====================================================
echo.
