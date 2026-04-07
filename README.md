# camera-api

TypeScript npm library starter, configured for Node `20.10.0`, build output in `dist`, and automated publish to npm via GitHub Actions.

## Requirements

- Node.js `20.10.0`
- npm `>=10`

## Node version setup (asdf / nvm)

This repo includes:

- `.tool-versions` for `asdf`
- `.nvmrc` for `nvm`

Use either:

```bash
# asdf
asdf install
asdf local nodejs 20.10.0

# nvm
nvm install
nvm use
```

## Install and develop

```bash
npm install
npm run typecheck
npm test
```

## Build

```bash
npm run build
```

Compiled files are emitted to `dist/`.

## Publish to npm (Semantic Release + GitHub Actions)

Publishing is handled by `semantic-release` via `.github/workflows/publish.yml`.

1. Set repository secret `NPM_TOKEN` (npm automation token).
2. Ensure package `name` in `package.json` is unique on npm.
3. Merge commits to `main` using Conventional Commits.

On each push to `main` (for example, after merging a PR), the workflow will:

- install dependencies
- run tests (which includes build)
- evaluate commits since last release
- calculate the next semantic version
- publish to npm with provenance
- create a GitHub Release

### Conventional Commit examples

```text
feat: add camera health endpoint
fix: handle missing camera id
perf: reduce map allocations in camera index
```

### Local release dry run (optional)

```bash
npm run release -- --dry-run
```

## CI

`.github/workflows/ci.yml` runs on push to `main` and on pull requests targeting `main` to verify install, typecheck, and tests.

## Branch protection checklist (`main`)

In GitHub repository settings, configure branch protection for `main` with:

- require a pull request before merging
- require status checks to pass before merging
- require the `CI / build-and-test` check
- require branches to be up to date before merging
- restrict direct pushes to `main` (optional but recommended)

## Community and governance

- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Issue templates and PR template: `.github/ISSUE_TEMPLATE/` and `.github/pull_request_template.md`
