# v1.0.0 Release Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the complete local MT5 review dashboard, remove verified dead runtime code, document AI-assisted deployment, and publish the accumulated platform/workspace changes as `v1.0.0`.

**Architecture:** Preserve the existing Python standard-library HTTP server, SQLite persistence, native multi-page frontend, GridStack layout editor, and ECharts chart rendering. The audit will fix only evidence-backed defects and stale references; it will not replace the architecture or touch private runtime data.

**Tech Stack:** Python 3.11+, `unittest`, Node.js native tests, native HTML/CSS/ES modules, vendored GridStack/ECharts, GitHub Actions, Git tags/releases.

**Spec:** `README.md`, `AGENTS.md`, `docs/VERSION-ROUTE.md`, current platform-workspace plans, and the existing release workflow.

## Global Constraints

- Never read, stage, commit, upload, or expose `mt5-review-system/data/`, `backups/`, `config.local.json`, screenshots, raw MT5 JSONL events, or generated binaries.
- Keep SQLite as the single source of truth and preserve platform-scoped campaign IDs and relationships.
- Keep the service local by default; deployment documentation must explicitly warn that the unauthenticated server is not public-internet safe.
- Use the project release checker before tagging; the tag must be `v1.0.0` and match `VERSION`.
- Do not use destructive Git commands or force-push.

---

### Task 1: Freeze the release baseline and audit boundaries

**Files:**
- Read: `README.md`, `AGENTS.md`, `docs/VERSION-ROUTE.md`, `docs/RELEASE-GUIDE.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`.
- Inspect: tracked files, worktree diff, package/test scripts, release checker.

- [x] Record branch, remote, current version, tracked/untracked file list, and test entry points.
- [x] Confirm sensitive paths are ignored and absent from the candidate staging set.
- [x] Run the existing release check before changes; record every failure as an audit item rather than guessing at fixes.

### Task 2: Run a defect and residual-code audit

**Files:**
- Inspect: `mt5-review-system/server/app/`, `mt5-review-system/web/`, `mt5-review-system/server/tests/`, `mt5-review-system/web/tests/`.
- Modify only files tied to reproduced defects or stale runtime references.

- [x] Run Python, Node, syntax, compatibility, benchmark, and browser gates using the project-provided commands.
- [x] Inspect route registration, platform query propagation, campaign/position ownership, dashboard analysis windows, GridStack state persistence, and ECharts resize/update paths.
- [x] Search for stale album/theme/mock/demo references and classify each as production compatibility code, test fixture, documentation example, or removable dead code.
- [x] For each confirmed bug, write a focused failing test, observe the failure, implement the smallest fix, and rerun the focused test.
- [x] Do not delete mock pages or compatibility routes unless all references and tests show they are no longer part of the supported workflow.

### Task 3: Update project and AI deployment documentation

**Files:**
- Create: `docs/AI-DEPLOYMENT-GUIDE.md`.
- Modify: `README.md`, `mt5-review-system/README.md`, `docs/PROJECT-GUIDE.md`, `docs/VERSION-ROUTE.md`, `docs/RELEASE-GUIDE.md`, `CHANGELOG.md`.

- [x] Document prerequisites, local startup, existing-data startup, health checks, port selection, MT5 EA setup, domestic-futures import, backup/restore, and verification commands.
- [x] Add an AI deployment workflow covering repository inspection, secret/data boundary, environment setup, test gates, local-only networking, rollback, and post-deploy smoke tests.
- [x] Include exact PowerShell commands and explicitly distinguish source files from private runtime data.
- [x] Document the platform-scoped campaign model, dashboard/order/album ownership rules, and GridStack/ECharts responsibilities.
- [x] Remove stale version and “planned/unreleased” wording that describes work already included in the 1.0 release.

### Task 4: Normalize release metadata to v1.0.0

**Files:**
- Modify: `VERSION`, `README.md`, `CHANGELOG.md`, `docs/VERSION-ROUTE.md`, `mt5-review-system/README.md`.

- [x] Set the canonical version to `1.0.0`.
- [x] Add a dated `1.0.0` changelog entry covering dual-platform workspaces, consolidated campaigns, dashboard customization, order review/check-ins, imports, fees, and verification status.
- [x] Make release-route statements consistent with the tag and release workflow.
- [x] Run the release checker and confirm it recognizes `v1.0.0` metadata.

### Task 5: Verify, review, and publish

**Files:**
- Stage only reviewed source, tests, documentation, workflow, and release metadata.

- [x] Run the complete release check, frontend tests, syntax checks, and desktop/390px browser smoke checks.
- [x] Inspect the staged file list and confirm no private data, screenshots, logs, databases, binaries, or generated artifacts are included.
- [x] Commit with a focused release message.
- [x] Create annotated tag `v1.0.0` without overwriting existing tags.
- [x] Push the commit and tag to `origin` without force-push; verify the remote branch and tag.
