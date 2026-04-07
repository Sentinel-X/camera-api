# Contributing

Thanks for helping improve `camera-api`.

## Development setup

1. Use Node `20.10.0`:
   - `nvm use` or
   - `asdf install && asdf local nodejs 20.10.0`
2. Install dependencies:
   - `npm install`
3. Run checks before opening a PR:
   - `npm run typecheck`
   - `npm test`

## Commit conventions

This project uses Conventional Commits for automated releases.

Examples:

- `feat: add hikvision preset helper`
- `fix: normalize dahua region bounds`
- `docs: clarify release process`

## Pull requests

- Keep PRs small and focused
- Add or update tests for behavioral changes
- Update docs when user-facing behavior changes
- Ensure CI is passing before requesting review

## Reporting bugs and proposing features

Use the issue templates in the repository to provide reproducible details.
