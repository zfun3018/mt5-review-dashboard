$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ConfigPath = Join-Path $ProjectRoot "config.local.json"
$EaSource = Join-Path $ProjectRoot "mt5-ea\MT5ReviewBridge.mq5"

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "config.local.json not found."
}

$Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$ExpertsDir = [string]$Config.mql5_experts_dir
$Destination = Join-Path $ExpertsDir "MT5ReviewBridge.mq5"

if (-not (Test-Path -LiteralPath $ExpertsDir)) {
  throw "Experts directory not found: $ExpertsDir"
}

Copy-Item -LiteralPath $EaSource -Destination $Destination -Force
Write-Host "EA source installed:"
Write-Host $Destination
