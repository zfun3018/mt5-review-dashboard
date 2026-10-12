# Contributing

感谢参与 MT5 复盘仪表盘的改进。

开始前请先阅读 [项目说明](docs/PROJECT-GUIDE.md) 和 [运行与开发说明](mt5-review-system/README.md)。版本路线见
[docs/VERSION-ROUTE.md](docs/VERSION-ROUTE.md)，正式版本发布请按 [GitHub Release 发布指南](docs/RELEASE-GUIDE.md)
执行，历史变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 开发约定

- 保持原生 HTML、CSS、JavaScript 和 Python 结构，除非变更有明确收益。
- 不提交真实交易数据库、截图、原始事件、备份包或本机配置。
- 新功能应补充对应的 Python 或前端静态测试。
- UI 修改需要检查桌面端和 390px 移动端布局。
- 提交前运行项目测试，并在变更说明中记录验证结果。
- 不要提交数据库、截图、原始 MT5 JSONL、备份或本机配置。

## 本地测试

在 `mt5-review-system/server` 目录运行 Python 测试：

```powershell
python -m unittest discover -s tests -p "test_*.py"
```

在 `mt5-review-system` 目录运行前端静态测试：

```powershell
node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js
```

## 提交 Pull Request

请说明变更目的、影响范围、测试结果和可能的兼容性影响。涉及数据模型的变更必须同时说明迁移和备份策略。
