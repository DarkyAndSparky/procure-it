#!/usr/bin/env bash
set -euo pipefail

NEW_VER="${1:-}"
if [[ -z "$NEW_VER" ]]; then
    echo "ERROR: specify version. Example: ./release.sh 26w35-r01"
    exit 1
fi

node "$(dirname "$0")/release-validate.js" "$NEW_VER"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "dev" ]]; then
    echo "ERROR: current branch is '$BRANCH', must be 'dev'"
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: uncommitted changes exist. Commit or stash them."
    exit 1
fi

echo
echo "=== procure-it release ==="
echo "Version: $NEW_VER"
echo

echo "[1/9] package.json ..."
node "$(dirname "$0")/release-bump.js" "$NEW_VER"

echo "[2/9] npm run version:sync ..."
npm run version:sync

echo "[3/9] git commit bump in dev ..."
git add package.json package-lock.json README.md docs/index.html Dockerfile docker-compose.yml 2>/dev/null || true
git commit -m "chore: bump version to $NEW_VER"

echo "[4/9] git checkout main ..."
git checkout main

echo "[5/9] git merge dev --no-ff ..."
git merge dev --no-ff -m "release: v$NEW_VER"

echo "[6/9] removing dev-only files from main ..."
git rm -r --cached --ignore-unmatch test/              2>/dev/null || true
git rm -r --cached --ignore-unmatch e2e/               2>/dev/null || true
git rm -r --cached --ignore-unmatch tools/             2>/dev/null || true
git rm    --cached --ignore-unmatch playwright.config.js 2>/dev/null || true
git rm    --cached --ignore-unmatch test.bat           2>/dev/null || true
git rm    --cached --ignore-unmatch test.sh            2>/dev/null || true
git rm    --cached --ignore-unmatch test-e2e.bat       2>/dev/null || true
git rm    --cached --ignore-unmatch test-e2e.sh        2>/dev/null || true
git rm    --cached --ignore-unmatch CONTRIBUTING.md    2>/dev/null || true
git rm    --cached --ignore-unmatch ROADMAP.md         2>/dev/null || true

rm -rf test/ e2e/ tools/
rm -f playwright.config.js test.bat test.sh test-e2e.bat test-e2e.sh CONTRIBUTING.md ROADMAP.md
echo "  done."

echo "[7/9] git commit strip ..."
if ! git diff --cached --quiet; then
    git commit -m "chore: strip dev-only files for release"
else
    echo "  nothing to commit, ok."
fi

echo "[8/9] git tag v$NEW_VER ..."
git tag "v$NEW_VER"

echo "[9/9] push main + tag, back to dev ..."
git push origin main --tags
git checkout dev
git push origin dev

echo
echo "===================================================="
echo " DONE! Release v$NEW_VER published in main."
echo " https://github.com/DarkyAndSparky/procure-it/releases/new"
echo " Tag: v$NEW_VER"
echo "===================================================="
echo
