$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ConfigPath = Join-Path $ProjectRoot "config.local.json"
$ProjectPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
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

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "config.local.json not found."
}

$Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$BridgeDir = [string]$Config.mql5_files_bridge_dir

Set-Location $ProjectRoot

& $PythonCommand .\tools\import_mt5_bridge.py $BridgeDir
