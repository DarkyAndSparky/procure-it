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
git tag v26w31-b01        # use current build number
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

`YYwWW-bNN` — year (2 digits) · ISO week number · build number on that week

Examples: `26w31-b01`, `26w31-b02`, `26w32-b01`

Bump the version in:
- `package.json` → `version`
- `README.md` → version badge
- Git tag on `main`

## Pull requests

- Branch from `dev`, target `dev`
- One feature or fix per PR

## Issues

Use [GitHub Issues](https://github.com/DarkyAndSparky/procure-it/issues) for bugs and feature requests.
