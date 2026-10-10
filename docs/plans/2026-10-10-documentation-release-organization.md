# 项目文档与 GitHub Releases 整理实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将项目说明、技术边界、版本路线、历史变更和 GitHub Release 发布流程拆分为清晰且可维护的文档体系。

**Architecture:** 根目录 README 作为用户入口，`docs/PROJECT-GUIDE.md` 作为技术说明，`docs/VERSION-ROUTE.md` 只维护路线与版本规则，`CHANGELOG.md` 维护已发布变更，`docs/RELEASE-GUIDE.md` 维护发布操作。新增 tag 触发的 GitHub Actions 工作流负责校验 `VERSION`、运行现有发布检查并创建 Release。

**Tech Stack:** Markdown、GitHub Actions、Python 3.11、Node.js 20、现有 `mt5-review-system/tools/check_release.py`。

---

### Task 1: 建立项目技术说明和历史变更记录

**Files:**
- Create: `docs/PROJECT-GUIDE.md`
- Create: `CHANGELOG.md`

**Step 1: Write the project guide**

记录项目定位、四个工作区、端到端数据流、后端四层边界、核心术语、本地数据目录、隐私边界、文档地图和现有设计档案入口。不得写入真实账户、终端、订单、截图或本机路径。

**Step 2: Move published history into the changelog**

从现有 `docs/VERSION-ROUTE.md` 整理 v0.1.0 至 v0.6.20 的已发布事实，使用 `Added`、`Changed`、`Fixed`、`Security` 等分类；保留版本号和重要兼容性说明，不复制未来计划。

**Step 3: Verify the new documents**

Run: `git diff --check`

Expected: no whitespace errors; both files contain only public project information and links to existing paths.

**Step 4: Commit**

```powershell
git add docs/PROJECT-GUIDE.md CHANGELOG.md
git commit -m "docs: add project guide and changelog"
```

### Task 2: Simplify the root project entry

**Files:**
- Modify: `README.md`

**Step 1: Replace mixed responsibilities with a short entry document**

保留项目介绍、适用场景、核心能力、环境要求、最快启动方式、安全提醒、文档地图、测试入口和当前版本链接。将完整安装、MT5 EA、局域网、数据目录和开发细节链接到对应文档或子项目 README。

**Step 2: Add release-oriented navigation**

明确当前版本来自 `VERSION`，正式版本通过 GitHub Releases 发布，并链接 `CHANGELOG.md`、`docs/VERSION-ROUTE.md` 和 `docs/RELEASE-GUIDE.md`。

**Step 3: Verify links and scope**

Run: `rg -n "README|VERSION|CHANGELOG|PROJECT-GUIDE|RELEASE-GUIDE|VERSION-ROUTE" README.md`

Expected: every primary document has one clear link and no long historical version section remains in the root README.

**Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: simplify project entry README"
```

### Task 3: Separate runtime instructions from technical duplication

**Files:**
- Modify: `mt5-review-system/README.md`

**Step 1: Keep operational instructions**

保留本地启动、MT5 EA 配置、JSONL 回灌、接口概览和开发验证命令，删除重复的产品介绍、长版本历史和重复架构说明。

**Step 2: Add stable cross-links**

在开头链接根目录 README、`docs/PROJECT-GUIDE.md`、`docs/VERSION-ROUTE.md`、`CHANGELOG.md` 和 `docs/RELEASE-GUIDE.md`，说明本文件只负责运行与开发细节。

**Step 3: Check sensitive-data wording**

Run: `rg -n "data|backups|config.local|screenshots|raw-events|真实|不要提交" mt5-review-system/README.md`

Expected: the document explains the private-data boundary without exposing actual local account or terminal values.

**Step 4: Commit**

```powershell
git add mt5-review-system/README.md
git commit -m "docs: focus app README on runtime details"
```

### Task 4: Rewrite version route and add release guide

**Files:**
- Modify: `docs/VERSION-ROUTE.md`
- Create: `docs/RELEASE-GUIDE.md`

**Step 1: Reframe the version route**

把文件改为当前版本、SemVer 规则、版本类型边界、完成条件、近期/中期/远期路线和历史记录入口。不要重复完整 changelog；已完成版本只保留当前版本和历史索引说明。

**Step 2: Write the release guide**

用 Windows PowerShell 示例说明：确认改动、更新 `VERSION`、更新 changelog 和路线、运行完整检查、提交、创建 `vX.Y.Z` tag、推送 tag、查看 Actions 和 GitHub Release。说明 tag 必须与 `VERSION` 完全一致，失败时不要重试创建错误版本。

**Step 3: Verify release instructions**

Run: `rg -n "VERSION|v0|git tag|git push|check_release|Release|CHANGELOG" docs/VERSION-ROUTE.md docs/RELEASE-GUIDE.md`

Expected: routes describe future work, guide describes actual release steps, and neither references private data.

**Step 4: Commit**

```powershell
git add docs/VERSION-ROUTE.md docs/RELEASE-GUIDE.md
git commit -m "docs: define roadmap and release procedure"
```

### Task 5: Automate GitHub Releases from version tags

**Files:**
- Create: `.github/release.yml`
- Create: `.github/workflows/release.yml`

**Step 1: Configure generated release notes**

按功能、修复、文档维护和其他变更分类；排除依赖更新噪音。配置只影响 GitHub Release 页面，不会修改源代码。

**Step 2: Add the tag workflow**

在 `v*` tag 推送时执行 checkout、Python 3.11、Node 20、项目安装、版本 tag 校验和 `python tools/check_release.py --skip-browser`。所有检查通过后使用仓库内置 `GITHUB_TOKEN` 和 `gh release create --generate-notes` 创建 Release，权限仅授予 `contents: write`。

**Step 3: Make tag mismatch fail before publishing**

用公开的根目录 `VERSION` 与 `GITHUB_REF_NAME` 比较：`VERSION=0.6.21` 只能接受 `v0.6.21`。不一致、检查失败或 Release 已存在时工作流停止。

**Step 4: Validate workflow text locally**

Run: `git diff --check; rg -n "tags:|GITHUB_REF_NAME|VERSION|check_release.py|gh release create|contents: write" .github/workflows/release.yml`

Expected: workflow contains all release gates and never reads private runtime directories.

**Step 5: Commit**

```powershell
git add .github/release.yml .github/workflows/release.yml
git commit -m "ci: publish GitHub Releases from version tags"
```

### Task 6: Final consistency and regression verification

**Files:**
- Verify: `README.md`
- Verify: `CHANGELOG.md`
- Verify: `VERSION`
- Verify: `docs/VERSION-ROUTE.md`
- Verify: `docs/RELEASE-GUIDE.md`
- Verify: `.github/workflows/release.yml`

**Step 1: Check version consistency**

Run: `$version = (Get-Content VERSION -Raw).Trim(); rg -n "v$version|$version" README.md CHANGELOG.md docs/VERSION-ROUTE.md docs/RELEASE-GUIDE.md`

Expected: current version is consistently identified as `v0.6.20` until a future release is intentionally prepared.

**Step 2: Run the project verification suite**

Run from `mt5-review-system/server`: `python -m unittest discover -s tests -p "test_*.py"`

Run from `mt5-review-system`: `node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js; node --check web/app.js; node --check web/album.js`

Expected: existing Python and frontend checks pass; documentation changes do not alter application behavior.

**Step 3: Inspect final diff and sensitive paths**

Run: `git diff --check; git status --short; git diff --stat`

Expected: only public documentation and GitHub workflow files changed; no `data/`, `backups/`, `config.local.json`, screenshots, raw JSONL, or generated binaries are staged.

**Step 4: Commit verification-only follow-up if needed**

Only create a follow-up commit if verification reveals a documentation or workflow correction. Do not create a release tag in this implementation task.

