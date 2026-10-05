param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 65535)]
  [int]$Port,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$RuleName = "MT5 Review Dashboard LAN"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue |
  Where-Object { $_.Enabled -eq "True" } |
  Select-Object -First 1

if ($rule) {
  Write-Host "Firewall rule already enabled: $RuleName"
  exit 0
}

if ($CheckOnly -or -not (Test-Administrator)) {
  exit 2
}

New-NetFirewallRule `
  -DisplayName $RuleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $Port `
  -Profile Private `
  -RemoteAddress LocalSubnet `
  -Description "Allow the unauthenticated MT5 review dashboard on the trusted Private LAN only." |
  Out-Null

Write-Host "Firewall rule created for TCP $Port on Private LocalSubnet."
