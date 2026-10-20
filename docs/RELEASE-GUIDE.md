# GitHub Release 发布指南

这份指南用于发布正式版本。普通开发提交不会自动生成 Release；只有推送与 `VERSION` 一致的 `vX.Y.Z` tag，GitHub Actions 才会运行发布检查并创建 Release。

## 发布前先理解三件事

- `VERSION`：当前版本号的唯一来源，例如 `1.0.0`；
- `CHANGELOG.md`：这个版本交付了什么，面向用户阅读；
- GitHub Release：对应一个版本 tag 的公开发布页面，由工作流自动创建。

三者必须表示同一个版本。不要把真实数据库、截图、原始 JSONL、备份或 `config.local.json` 放进提交、Release 附件或变更说明。

## 什么时候发布

以下内容可以合并到普通提交，但准备交付给用户时才创建版本：

- 一个可独立使用的新功能；
- 一个影响用户行为或数据兼容性的修复；
- 一组值得让用户明确知道的体验和可靠性改进。

文档小修可以随下一个功能版本或补丁版本发布，不需要每次修改都创建 Release。

## 发布步骤

### 1. 确认工作区

在项目根目录运行：

```powershell
git status --short
git branch --show-current
```

先处理未完成的改动。不要在包含真实数据、截图、备份或本机配置的状态下执行 `git add -A`；按文件名明确添加公开文件。

### 2. 选择版本号

打开根目录 `VERSION`，按照 [版本路线](VERSION-ROUTE.md) 修改为新的三段版本号：

- `PATCH`：修复和局部改进，例如 `1.0.1`；
- `MINOR`：向后兼容的新功能，例如 `1.1.0`；
- `MAJOR`：不兼容的重大变化，例如 `1.0.0`。

如果没有明确的新版本内容，不要为了发布而增加版本号。

### 3. 更新公开说明

同步更新：

- `CHANGELOG.md`：在顶部增加新版本和用户能理解的变更；
- `docs/VERSION-ROUTE.md`：把已完成事项从计划移到当前状态或交付版本；
- README：只有启动方式、项目能力或文档入口变化时才更新。

不要把未实现的计划写入新版本的变更记录。

### 4. 运行发布检查

完整本地检查需要在 `mt5-review-system` 目录运行：

```powershell
Set-Location .\mt5-review-system
python .\tools\check_release.py
```

如果本机没有 Playwright/Chromium，可以先运行 CI 同样的无浏览器门禁：

```powershell
python .\tools\check_release.py --skip-browser
```

正式发布前仍应尽量运行完整检查。检查失败时先修复问题，不要创建 tag。

### 5. 提交发布元数据

回到项目根目录，确认版本号和变更记录只包含公开内容：

```powershell
Set-Location ..
git diff --check
git diff -- VERSION CHANGELOG.md docs/VERSION-ROUTE.md README.md
git add VERSION CHANGELOG.md docs/VERSION-ROUTE.md
git commit -m "release: prepare v1.0.0"
```

命令中的版本号必须替换为本次实际版本。README 发生变化时再把 `README.md` 加入暂存区。

### 6. 推送提交和版本 tag

读取版本号并创建带注释的 tag：

```powershell
$version = (Get-Content .\VERSION -Raw).Trim()
$tag = "v$version"
git tag -a $tag -m "Release $tag"
git push origin main
git push origin $tag
```

如果默认分支不是 `main`，将第一条推送命令替换为实际的发布分支。tag 一旦推送就代表公开版本；不要使用 `git push --force` 移动版本 tag，也不要把 tag 指向包含私有数据的提交。

### 7. 检查自动 Release

推送 tag 后，打开 GitHub 仓库的 **Actions** 页面，查看 `Release` 工作流：

1. tag 与 `VERSION` 校验通过；
2. Python、Node、语法、兼容性和基准检查通过；
3. GitHub 自动创建同名 Release，并生成变更说明。

完成后，在 **Releases** 页面确认标题、tag 和变更说明正确。需要补充用户可读说明时，直接编辑 Release 页面，不要修改已经发布的 tag。

## 发布失败怎么办

- 版本校验失败：说明 tag 与 `VERSION` 不一致。不要创建第二个同名 tag，检查提交内容并准备一个新的正确版本。
- 测试失败：先修复代码或测试，再按新的补丁版本发布；不要绕过发布检查。
- Release 已存在：说明这个 tag 已经发布过。不要覆盖或强制移动 tag。
- Actions 权限失败：检查仓库是否允许 GitHub Actions 使用 `contents: write`，不要把个人访问令牌写入仓库文件。

正式发布后，如果发现影响数据安全、迁移或统计口径的问题，应立即在下一个补丁版本修复，并在 CHANGELOG 和 Release 中明确说明影响范围。

## 发布后的检查清单

- GitHub Release 的 tag 与 `VERSION` 一致；
- Release 说明没有账户号、订单号、终端 ID、本机路径、截图或数据库内容；
- `CHANGELOG.md`、版本路线和根 README 的当前版本一致；
- 本地数据目录和配置仍被 `.gitignore` 忽略；
- 用户能从 Release 页面找到根 README 和运行说明。

