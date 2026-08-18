<#
.SYNOPSIS
  Registers Jarvis to start automatically when you log in.

.DESCRIPTION
  Creates two Scheduled Tasks that run hidden at logon:
    Jarvis Orchestrator - the backend. This is the one that matters: scheduled
                          automations only fire while it is running.
    Jarvis Dashboard    - the web UI at http://localhost:3000.

  Both are built in production mode first. Logs are written to scripts/logs.

  Re-running this script is safe; it replaces any existing tasks.
#>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$orchestratorDir = Join-Path $root "apps\orchestrator"
$webDir = Join-Path $root "apps\web"
$logDir = Join-Path $PSScriptRoot "logs"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw "node was not found on PATH. Install Node.js, open a new terminal, and re-run."
}
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source }
if (-not $npm) { throw "npm was not found on PATH." }

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

Write-Host "Building orchestrator..." -ForegroundColor Cyan
Push-Location $orchestratorDir
& $npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Orchestrator build failed." }
Pop-Location

Write-Host "Building dashboard (this takes a minute)..." -ForegroundColor Cyan
Push-Location $webDir
& $npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Dashboard build failed." }
Pop-Location

function Register-JarvisTask {
  param(
    [string]$TaskName,
    [string]$WorkingDirectory,
    [string]$Command,
    [string]$LogFile
  )

  # Wrap in PowerShell so the console window stays hidden and output is captured.
  $inner = "Set-Location '$WorkingDirectory'; $Command *>> '$LogFile'"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$inner`""

  # Boot trigger as well as logon: this machine signs the user out automatically,
  # and a logon-only task dies with the session, taking every automation with it.
  $triggers = @(
    New-ScheduledTaskTrigger -AtStartup
    New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  )

  # S4U = "run whether the user is logged on or not" without storing a password.
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U -RunLevel Limited

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

  # Both triggers can fire in one session; without IgnoreNew the second instance
  # would race the first for port 4317 and crash.

  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Principal $principal -Settings $settings | Out-Null

  Write-Host "  registered: $TaskName" -ForegroundColor Green
}

Write-Host "Registering scheduled tasks..." -ForegroundColor Cyan
Register-JarvisTask -TaskName "Jarvis Orchestrator" `
  -WorkingDirectory $orchestratorDir `
  -Command "& '$node' dist/http/server.js" `
  -LogFile (Join-Path $logDir "orchestrator.log")

Register-JarvisTask -TaskName "Jarvis Dashboard" `
  -WorkingDirectory $webDir `
  -Command "& '$npm' run start" `
  -LogFile (Join-Path $logDir "dashboard.log")

Write-Host ""
Write-Host "Done. Jarvis will start automatically when you log in." -ForegroundColor Green
Write-Host "Start it now without logging out:" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName 'Jarvis Orchestrator'"
Write-Host "  Start-ScheduledTask -TaskName 'Jarvis Dashboard'"
Write-Host ""
Write-Host "Logs:      $logDir"
Write-Host "Dashboard: http://localhost:3000"
Write-Host "Remove:    .\scripts\uninstall-service.ps1"
