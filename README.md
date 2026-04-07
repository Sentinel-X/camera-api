# camera-api

TypeScript npm library for interacting with Dahua, Hikvision, and Intelbras camera APIs through each vendor's HTTP interface.

Install:

```bash
npm install @sentinelx/camera-api
```

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

## Development checks

Before opening a pull request, run:

```bash
npm run typecheck
npm test
```

## Community and governance

- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Issue templates and PR template: `.github/ISSUE_TEMPLATE/` and `.github/pull_request_template.md`
