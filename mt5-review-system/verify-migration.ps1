$ErrorActionPreference = "Stop"

# 验证 v0.6.0 已经能读 v0.5.8 的真实数据。
#
# 用法（PowerShell）:
#   .\verify-migration.ps1 [-BaseUrl http://127.0.0.1:8787]

param(
  [string]$BaseUrl = "http://127.0.0.1:8787"
)

function Check-Status {
  param([string]$Name, [string]$Url, [int]$ExpectedMinCount = 0)
  Write-Host "Checking $Name ..."
  $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
  if ($resp.StatusCode -ne 200) {
    throw "$($Name) returned HTTP $($resp.StatusCode)"
  }
  $body = $resp.Content | ConvertFrom-Json
  if ($ExpectedMinCount -gt 0) {
    $count = if ($body.PSObject.Properties.Name -contains 'count') { $body.count }
             elseif ($body.PSObject.Properties.Name -contains 'total') { $body.total }
             elseif ($body.PSObject.Properties.Name -contains 'trades') { @($body.trades).Count }
             else { $null }
    if ($null -ne $count -and $count -lt $ExpectedMinCount) {
      throw "$($Name) count $count is below expected minimum $ExpectedMinCount"
    }
  }
  Write-Host "  -> OK ($($resp.StatusCode))"
}

Write-Host "== Migration Verification =="
Write-Host "Base URL: $BaseUrl"
Write-Host ""

Check-Status -Name "/api/health"       -Url "$BaseUrl/api/health"
Check-Status -Name "/api/trades"       -Url "$BaseUrl/api/trades"       -ExpectedMinCount 100
Check-Status -Name "/api/orders"       -Url "$BaseUrl/api/orders"       -ExpectedMinCount 100
Check-Status -Name "/api/analysis"     -Url "$BaseUrl/api/analysis"
Check-Status -Name "/api/equity-curve" -Url "$BaseUrl/api/equity-curve"
Check-Status -Name "/api/album/sources"-Url "$BaseUrl/api/album/sources"

Write-Host ""
Write-Host "All migration checks passed."