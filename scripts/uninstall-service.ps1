<#
.SYNOPSIS
  Removes the Jarvis logon tasks. Leaves your data and credentials untouched.
#>

$ErrorActionPreference = "Stop"

foreach ($name in @("Jarvis Orchestrator", "Jarvis Dashboard")) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "removed: $name" -ForegroundColor Yellow
  } else {
    Write-Host "not installed: $name"
  }
}

Write-Host "Done. jarvis.db and jarvis.key were not touched." -ForegroundColor Green
