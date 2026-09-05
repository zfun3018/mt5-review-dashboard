$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
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

Set-Location $ProjectRoot

# Keep the unauthenticated service local unless LAN access is explicitly requested.
if (-not $env:MT5_REVIEW_HOST) { $env:MT5_REVIEW_HOST = "127.0.0.1" }
if (-not $env:MT5_REVIEW_PORT) { $env:MT5_REVIEW_PORT = "8787" }

$LanIp = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName()).AddressList |
  Where-Object {
    $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
    $_.IPAddressToString -match "^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)"
  } |
  Select-Object -First 1 -ExpandProperty IPAddressToString

Write-Host "Local URL: http://127.0.0.1:$($env:MT5_REVIEW_PORT)"
if ($env:MT5_REVIEW_HOST -eq "0.0.0.0" -and $LanIp) {
  Write-Host "LAN URL:   http://$($LanIp):$($env:MT5_REVIEW_PORT)"
}
Write-Host "Bind host: $($env:MT5_REVIEW_HOST)"

& $PythonCommand .\run.py
