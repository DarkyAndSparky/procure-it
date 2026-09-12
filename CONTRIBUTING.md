# Contributing to procure-it

## Branch strategy

This project uses a two-branch workflow:

| Branch | Purpose |
|--------|---------|
| `main` | Stable releases only. Never commit directly. |
| `dev`  | Active development, experiments, bug fixes. Default working branch. |

## Daily workflow

```bash
# Always work in dev
git checkout dev

# Make changes, then commit
git add .
git commit -m "fix: description of change"
git push origin dev
```

## Releasing to main

Don't do this by hand — use the release script, which handles version
bumping, syncing the version everywhere (`npm run version:sync`), stripping
dev-only files (`test/`, `e2e/`, `tools/`, `playwright.config.js`, etc. —
`main` should never contain them) from the release commit, tagging, and
pushing, in the right order:

```bash
git checkout dev
tools/release/release.bat 26w31-b01   # Windows
./tools/release/release.sh 26w31-b01  # Linux/macOS
```

Requires: `dev` is the current branch, working tree is clean (commit or
stash first), version matches `YYwWW-{a|b|rc|r}NN` (see below).

If you ever do need to do it by hand (script unavailable, debugging a
release problem), the steps it automates are: bump `package.json` version →
`npm run version:sync` → `npm install --package-lock-only` (keeps
`package-lock.json`'s version field in sync — easy to forget) → commit on
`dev` → merge into `main` → remove dev-only files from the `main` commit →
tag `vYYwWW-STAGENN` → push `main` with tags → checkout back to `dev` →
push `dev`.

## Commit message format

```
type: short description

Types:
  feat     — new feature
  fix      — bug fix
  refactor — code change without feature/fix
  docs     — documentation only
  chore    — build, deps, config
```

## Version format

`YYwWW-STAGENN` — year (2 digits) · ISO week number · stage · build number on that week+stage

| Stage | Meaning |
|-------|---------|
| `a`   | Alpha — early, potentially unstable, active work in `dev` |
| `b`   | Beta — feature-complete, being tested |
| `rc`  | Release candidate — final check before merging into `main` |
| `r`   | Release — final, merged into `main` |

Examples: `26w31-b01`, `26w31-rc01`, `26w31-r01`, `26w32-a01`

**`package.json` → `version` is the single source of truth.** Bump it there, then run:

```bash
npm run version:sync
```

This rewrites every other place the version is displayed (README badge, docs site header/footer, Docker image tag) automatically — you no longer need to hunt them down and edit them by hand. Commit the resulting changes together with the version bump, then tag as shown above.

## Pull requests

- Branch from `dev`, target `dev`
- One feature or fix per PR

## Issues

Use [GitHub Issues](https://github.com/DarkyAndSparky/procure-it/issues) for bugs and feature requests.
