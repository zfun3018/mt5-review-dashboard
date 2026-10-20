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

function Get-ListeningProcessIds {
  @(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:MT5_REVIEW_PORT) -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-ExistingReviewService {
  $processIds = @(Get-ListeningProcessIds)
  if ($processIds.Count -eq 0) { return }

  $health = $null
  try {
    $health = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "http://127.0.0.1:$($env:MT5_REVIEW_PORT)/api/health" `
      -TimeoutSec 2 `
      -ErrorAction Stop
  } catch {
    throw "Port $($env:MT5_REVIEW_PORT) is already in use and could not be verified as this project. Stop the existing process before starting."
  }

  $healthPayload = $health.Content | ConvertFrom-Json -ErrorAction Stop
  $isReviewHealth = ($health.StatusCode -eq 200 -and $healthPayload.ok -eq $true -and $healthPayload.mode -eq 'local' -and $null -ne $healthPayload.database)
  if (-not $isReviewHealth) {
    throw "Port $($env:MT5_REVIEW_PORT) is already used by another service. Change the port or stop that service first."
  }

  foreach ($processId in $processIds) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process -or $process.Path -notmatch '\\python(w)?\.exe$') {
      throw "The process using port $($env:MT5_REVIEW_PORT) is not a Python service. Startup stopped to avoid terminating the wrong process."
    }
  }

  Write-Host "Stopping existing MT5 Review local service on port $($env:MT5_REVIEW_PORT)..."
  foreach ($processId in $processIds) {
    Stop-Process -Id $processId -Force -ErrorAction Stop
  }

  $deadline = (Get-Date).AddSeconds(5)
  do {
    Start-Sleep -Milliseconds 200
    $remaining = @(Get-ListeningProcessIds)
  } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)

  if ($remaining.Count -gt 0) {
    throw "The previous service did not release port $($env:MT5_REVIEW_PORT). Stop it manually before starting."
  }
}

Stop-ExistingReviewService

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
