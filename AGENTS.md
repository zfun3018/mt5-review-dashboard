# Project AI Instructions

## Project scope

This is a local MT5 trade review dashboard. The server uses Python standard-library HTTP APIs and SQLite. The frontend is native HTML, CSS, and JavaScript. Keep the existing architecture unless a change has a clear, tested benefit.

## Sensitive data boundary

- Never read, upload, stage, or commit `mt5-review-system/data/`, `backups/`, `config.local.json`, screenshots, raw MT5 JSONL events, or generated binaries.
- Treat account numbers, order numbers, terminal IDs, local paths, and screenshots as private user data.
- Do not expose the local service to the public internet. It has no authentication.

## Before editing

1. Read `README.md`, `docs/VERSION-ROUTE.md`, and the relevant tests.
2. Trace the existing data flow and state the root cause before changing behavior.
3. Keep changes scoped to the requested feature.

## Verification

Run Python tests from `mt5-review-system/server`:

```powershell
python -m unittest discover -s tests -p "test_*.py"
```

Run frontend tests from `mt5-review-system`:

```powershell
node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js
node --check web/app.js
node --check web/album.js
```

For UI changes, verify desktop and 390px mobile layouts and check for console errors or horizontal overflow.

## Git rules

- Do not use destructive reset/checkout/clean commands without explicit approval.
- Do not force-push.
- Use a focused commit message and update the version route for user-visible releases.
