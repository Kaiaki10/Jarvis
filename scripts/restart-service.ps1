<#
.SYNOPSIS
  Rebuilds and restarts Jarvis. Use this to apply code changes.

.DESCRIPTION
  Stop-ScheduledTask alone is not enough: the task action is a PowerShell wrapper
  (needed to capture logs) and Task Scheduler does not reliably kill the node child
  it spawns. The orphan keeps holding ports 3000/4317, the freshly started instance
  fails to bind, and the OLD code carries on serving — silently, which is the worst
  part. So this stops the tasks, kills whatever still owns the ports, rebuilds,
  then starts them again. If a build fails, the previous build is put back and
  restarted, and the script exits 1.

.PARAMETER SkipBuild
  Restart without rebuilding.

.PARAMETER RestoreFrom
  Restore dist/, .next/, and jarvis.db from a snapshot directory before
  starting back up — for rolling back an update that didn't come back
  healthy. Restoring happens after the old
  process has released the port (and therefore its file handles) and before
  the new one opens them, so nothing is swapped out from under a live
  process.
#>

param([switch]$SkipBuild, [string]$RestoreFrom)

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
      Write-Host "  could not stop PID $procId on port ${Port}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}

# A restore puts back a prior build, so building first would only be overwritten.
$build = -not $SkipBuild -and -not $RestoreFrom
if ($build) {
  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source }
  if (-not $npm) { throw "npm was not found on PATH." }
}

# Building happens only after the service is stopped. `next start` loads chunk
# files from .next/ on demand, and `next build` rewrites .next/ in place with new
# content hashes, so building under a live dashboard crash-loops it with
# ChunkLoadError (seen 2026-08-24), which then takes the orchestrator down too.
Write-Host "Stopping..." -ForegroundColor Cyan
# S4U child processes can be protected from an interactive Stop-Process call.
# Ask current versions to exit themselves first; the port-owner pass below is a
# fallback for older builds and crashed wrappers.
foreach ($uri in @("http://127.0.0.1:4317/shutdown", "http://127.0.0.1:3000/api/shutdown")) {
  try { Invoke-WebRequest $uri -Method Post -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {}
}
Start-Sleep -Seconds 2
foreach ($t in $tasks) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    try { Stop-ScheduledTask -TaskName $t } catch {}
  }
}
Start-Sleep -Seconds 2
foreach ($p in $ports) { Stop-PortOwner -Port $p }
Start-Sleep -Seconds 1

$remaining = foreach ($p in $ports) {
  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
}
if ($remaining) {
  $details = ($remaining | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) PID $($_.OwningProcess)" }) -join ", "
  throw "Old Jarvis processes still own production ports ($details). Run this script from an elevated PowerShell window, or reboot, then run it again. The old service was not reported as the new build."
}

if ($RestoreFrom) {
  Write-Host "Restoring from snapshot: $RestoreFrom" -ForegroundColor Cyan
  if (-not (Test-Path $RestoreFrom)) { throw "Snapshot directory not found: $RestoreFrom" }
  Remove-Item -Recurse -Force (Join-Path $orchestratorDir "dist")
  Copy-Item -Recurse -Force (Join-Path $RestoreFrom "orchestrator-dist") (Join-Path $orchestratorDir "dist")
  Remove-Item -Recurse -Force (Join-Path $webDir ".next")
  Copy-Item -Recurse -Force (Join-Path $RestoreFrom "web-next") (Join-Path $webDir ".next")
  # The snapshot is a `node:sqlite` online backup (db/backup.ts) — a single
  # consistent file, not a raw copy of a live WAL-mode database. Clearing any
  # -wal/-shm sidecars left by the process that was just stopped means SQLite
  # opens the restored file cleanly rather than replaying WAL frames that
  # belong to a database state which no longer exists.
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $orchestratorDir "jarvis.db-wal")
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $orchestratorDir "jarvis.db-shm")
  Copy-Item -Force (Join-Path $RestoreFrom "jarvis.db") (Join-Path $orchestratorDir "jarvis.db")
}

$buildError = $null
if ($build) {
  # Set the running build aside first. Both builds clear their output before
  # writing, so a failed build would otherwise leave nothing to start, and the
  # service is already down at this point. On failure the old build goes back
  # and is restarted, so a broken change costs a restart, not an outage.
  $lastGood = Join-Path $root "promotion-snapshots\last-good"
  if (Test-Path $lastGood) { Remove-Item -Recurse -Force $lastGood }
  New-Item -ItemType Directory -Force $lastGood | Out-Null
  $outputs = @(
    @{ Path = (Join-Path $orchestratorDir "dist"); Saved = (Join-Path $lastGood "orchestrator-dist") },
    @{ Path = (Join-Path $webDir ".next"); Saved = (Join-Path $lastGood "web-next") }
  )
  foreach ($o in $outputs) {
    if (Test-Path $o.Path) { Copy-Item -Recurse -Force $o.Path $o.Saved }
  }

  foreach ($step in @(@{ Name = "orchestrator"; Dir = $orchestratorDir }, @{ Name = "dashboard"; Dir = $webDir })) {
    Write-Host "Building $($step.Name)..." -ForegroundColor Cyan
    Push-Location $step.Dir
    # Under "Stop", PowerShell 5.1 turns a failing build's stderr into a
    # terminating NativeCommandError, which would skip the rollback below with
    # the service already down. Judge the build by its exit code instead.
    $ErrorActionPreference = "Continue"
    & $npm run build
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    Pop-Location
    if ($code -ne 0) { $buildError = "The $($step.Name) build failed"; break }
  }

  if ($buildError) {
    Write-Host "$buildError - restoring the previous build and restarting it." -ForegroundColor Red
    foreach ($o in $outputs) {
      if (-not (Test-Path $o.Saved)) { continue }
      if (Test-Path $o.Path) { Remove-Item -Recurse -Force $o.Path }
      Copy-Item -Recurse -Force $o.Saved $o.Path
    }
  }
}

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
    try { $orchestrator = (Invoke-WebRequest "http://127.0.0.1:4317/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {}
  }
  if (-not $dashboard) {
    try { $dashboard = (Invoke-WebRequest "http://127.0.0.1:3000" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
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
if ($buildError) {
  Write-Host "$buildError, so the PREVIOUS build is what's running. Fix the error above and run this again." -ForegroundColor Red
  exit 1
}
