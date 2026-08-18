<#
.SYNOPSIS
  Rebuilds and restarts Jarvis. Use this to apply code changes.

.DESCRIPTION
  Stop-ScheduledTask alone is not enough: the task action is a PowerShell wrapper
  (needed to capture logs) and Task Scheduler does not reliably kill the node child
  it spawns. The orphan keeps holding ports 3000/4317, the freshly started instance
  fails to bind, and the OLD code carries on serving — silently, which is the worst
  part. So this stops the tasks, kills whatever still owns the ports, then starts
  them again.

.PARAMETER SkipBuild
  Restart without rebuilding.
#>

param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$orchestratorDir = Join-Path $root "apps\orchestrator"
$webDir = Join-Path $root "apps\web"
$tasks = @("Jarvis Orchestrator", "Jarvis Dashboard")
$ports = @(4317, 3000)

function Stop-PortOwner {
  param([int]$Port)
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($procId in ($conns.OwningProcess | Sort-Object -Unique)) {
    if (-not $procId) { continue }
    try {
      $p = Get-Process -Id $procId -ErrorAction Stop
      Stop-Process -Id $procId -Force
      Write-Host "  killed $($p.ProcessName) (PID $procId) holding port $Port" -ForegroundColor Yellow
    } catch {
      # Already gone between listing and killing — fine.
    }
  }
}

if (-not $SkipBuild) {
  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source }
  if (-not $npm) { throw "npm was not found on PATH." }

  Write-Host "Building orchestrator..." -ForegroundColor Cyan
  Push-Location $orchestratorDir
  & $npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Orchestrator build failed - not restarting." }
  Pop-Location

  Write-Host "Building dashboard..." -ForegroundColor Cyan
  Push-Location $webDir
  & $npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Dashboard build failed - not restarting." }
  Pop-Location
}

Write-Host "Stopping..." -ForegroundColor Cyan
foreach ($t in $tasks) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    try { Stop-ScheduledTask -TaskName $t } catch {}
  }
}
Start-Sleep -Seconds 2
foreach ($p in $ports) { Stop-PortOwner -Port $p }
Start-Sleep -Seconds 1

Write-Host "Starting..." -ForegroundColor Cyan
foreach ($t in $tasks) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName $t
  } else {
    Write-Host "  $t is not installed - run install-service.ps1" -ForegroundColor Yellow
  }
}

# Confirm they actually came back, rather than assuming.
$deadline = (Get-Date).AddSeconds(90)
$orchestrator = $false
$dashboard = $false
while ((Get-Date) -lt $deadline -and -not ($orchestrator -and $dashboard)) {
  if (-not $orchestrator) {
    try { $orchestrator = (Invoke-WebRequest "http://localhost:4317/platforms" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {}
  }
  if (-not $dashboard) {
    try { $dashboard = (Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
  }
  if (-not ($orchestrator -and $dashboard)) { Start-Sleep -Seconds 2 }
}

Write-Host ""
Write-Host ("  orchestrator : " + $(if ($orchestrator) { "up" } else { "NOT RESPONDING" })) -ForegroundColor $(if ($orchestrator) { "Green" } else { "Red" })
Write-Host ("  dashboard    : " + $(if ($dashboard) { "up" } else { "NOT RESPONDING" })) -ForegroundColor $(if ($dashboard) { "Green" } else { "Red" })
if (-not ($orchestrator -and $dashboard)) {
  Write-Host "Check scripts/logs for errors." -ForegroundColor Yellow
  exit 1
}
