<#
.SYNOPSIS
  Restores a Jarvis SQLite data backup downloaded from Settings.

.PARAMETER BackupPath
  Path to a jarvis-data-YYYY-MM-DD.db backup file.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path -LiteralPath $BackupPath).Path
$header = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($source), 0, 15)
if ($header -ne "SQLite format 3") {
  throw "The selected file is not a SQLite database backup."
}

$root = Split-Path -Parent $PSScriptRoot
$orchestratorDir = Join-Path $root "apps\orchestrator"
$target = if ($env:JARVIS_DB_PATH) {
  if ([System.IO.Path]::IsPathRooted($env:JARVIS_DB_PATH)) {
    [System.IO.Path]::GetFullPath($env:JARVIS_DB_PATH)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $orchestratorDir $env:JARVIS_DB_PATH))
  }
} else {
  Join-Path $orchestratorDir "jarvis.db"
}
if ([System.IO.Path]::GetFullPath($source) -eq [System.IO.Path]::GetFullPath($target)) {
  throw "The backup file and live database are the same file."
}
$safety = Join-Path $orchestratorDir ("jarvis-before-restore-{0}.db" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

Write-Host "Stopping Jarvis orchestrator..." -ForegroundColor Cyan
if (Get-ScheduledTask -TaskName "Jarvis Orchestrator" -ErrorAction SilentlyContinue) {
  try { Stop-ScheduledTask -TaskName "Jarvis Orchestrator" } catch {}
}
Start-Sleep -Seconds 2

$connections = Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue
foreach ($procId in ($connections.OwningProcess | Sort-Object -Unique)) {
  if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
}

if (Test-Path -LiteralPath $target) {
  Copy-Item -LiteralPath $target -Destination $safety
  Write-Host "Safety copy: $safety" -ForegroundColor Yellow
}

Copy-Item -LiteralPath $source -Destination $target -Force
foreach ($sidecar in @("$target-wal", "$target-shm")) {
  if (Test-Path -LiteralPath $sidecar) { Remove-Item -LiteralPath $sidecar -Force }
}

if (Get-ScheduledTask -TaskName "Jarvis Orchestrator" -ErrorAction SilentlyContinue) {
  Start-ScheduledTask -TaskName "Jarvis Orchestrator"
  Write-Host "Restore complete. Jarvis orchestrator is starting." -ForegroundColor Green
} else {
  Write-Host "Restore complete. Start the orchestrator normally when ready." -ForegroundColor Green
}
