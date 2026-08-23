# MT5 复盘仪表盘

当前稳定开发版本为 `v0.4.1`，主项目位于 `mt5-review-system/`。

- 项目说明：`mt5-review-system/README.md`
- 版本路线：`docs/VERSION-ROUTE.md`
- v0.2.0 实施记录：`docs/plans/2026-08-18-mt5-review-v02.md`
- 需求与优化依据：`MT交易复盘系统.md`

在 Windows 下可直接运行 `一键启动MT5复盘仪表盘.bat`，或进入
`mt5-review-system/` 后运行 `start.ps1`。默认访问地址为
`http://127.0.0.1:8787`。

一键启动脚本默认同时监听可信局域网。电脑浏览器使用
`http://127.0.0.1:8787`，手机或其他局域网设备使用启动窗口显示的
`http://<电脑局域网IP>:8787`。如果 Windows 防火墙拦截，请仅在“专用网络”中放行 TCP 8787，
不要将端口转发到公网。

本地数据库、交易事件、截图、备份和机器配置不纳入版本控制。
