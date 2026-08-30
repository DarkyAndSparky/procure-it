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

When `dev` is stable and tested:

```bash
git checkout main
git merge dev
git tag v26w31-b01        # matches package.json → version, prefixed with v
git push origin main --tags
git checkout dev           # always return to dev
```

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
