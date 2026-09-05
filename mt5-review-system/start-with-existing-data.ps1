$ErrorActionPreference = "Stop"

# 一键启动 v0.6.1，指向已有的真实数据。
# 数据完全不动；通过环境变量把 data 与 config 指向指定实例。
#
# 用法（PowerShell）:
#   cd F:\文件\MT5复盘仪表盘\mt5-review-system
#   .\start-with-existing-data.ps1

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# 默认数据目录（可在调用前设置 MT5_V05_DATA_DIR 覆盖）
$V05DataDir = $env:MT5_V05_DATA_DIR
if (-not $V05DataDir) {
  $V05DataDir = "F:\文件\MT5复盘仪表盘\mt5-review-system\data"
}
$V05ConfigFile = $env:MT5_V05_CONFIG_FILE
if (-not $V05ConfigFile) {
  $V05ConfigFile = "F:\文件\MT5复盘仪表盘\mt5-review-system\config.local.json"
}

if (-not (Test-Path -LiteralPath $V05DataDir)) {
  throw "v0.5.8 data dir not found: $V05DataDir"
}
if (-not (Test-Path -LiteralPath $V05ConfigFile)) {
  throw "v0.5.8 config.local.json not found: $V05ConfigFile"
}

$env:MT5_REVIEW_DATA_DIR    = $V05DataDir
$env:MT5_REVIEW_CONFIG_FILE = $V05ConfigFile

if (-not $env:MT5_REVIEW_HOST) { $env:MT5_REVIEW_HOST = "127.0.0.1" }
if (-not $env:MT5_REVIEW_PORT) { $env:MT5_REVIEW_PORT = "8787" }

Write-Host "[v0.6.1] project root  : $ScriptRoot"
Write-Host "[v0.6.1] data dir      : $env:MT5_REVIEW_DATA_DIR"
Write-Host "[v0.6.1] config file   : $env:MT5_REVIEW_CONFIG_FILE"
Write-Host "[v0.6.1] bind          : http://$($env:MT5_REVIEW_HOST):$($env:MT5_REVIEW_PORT)"
Write-Host ""

$ProjectPython = Join-Path $ScriptRoot ".venv\Scripts\python.exe"
$PythonCommand = $env:MT5_REVIEW_PYTHON
if (-not $PythonCommand -and (Test-Path -LiteralPath $ProjectPython)) {
  $PythonCommand = $ProjectPython
}
if (-not $PythonCommand) {
  $PythonCommand = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $PythonCommand) {
  throw "Python not found. Install Python 3.11+ or set MT5_REVIEW_PYTHON to its executable path."
}

& $PythonCommand (Join-Path $ScriptRoot "run.py")
