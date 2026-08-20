<#
.SYNOPSIS
  Launches promote-lab.ps1 as a genuinely independent process and exits
  immediately.

.DESCRIPTION
  promote-lab.ps1 has to survive the orchestrator's own scheduled task being
  stopped and restarted partway through its own run — that is the entire
  point of it being a separate script. A direct Node child_process.spawn of
  promote-lab.ps1 from the orchestrator turned out to have two different
  failure modes on this machine, both found by rehearsing a real promotion
  rather than trusting the code: spawned with `detached: true`, the process
  never actually started (no trace anywhere, confirmed against Task Manager
  and an empty redirected-output log, three times); spawned without it, the
  process ran correctly but was then killed mid-restart, because it was
  still part of the "Jarvis Orchestrator" scheduled task's process tree —
  stopping that task to restart it also killed the very process trying to
  do the restarting and record the outcome, leaving a promotion stuck
  forever in "promoting" with the live service down and nobody told.

  Start-Process here uses ShellExecute-style process creation rather than
  Node's direct CreateProcess, which reliably escapes the calling task's
  process tree on this machine where a raw detached spawn did not. This
  script's only job is to launch the real one and return; it does not wait,
  so its own death (it is still part of the tree until it exits) does not
  matter once the real process is running independently.

.PARAMETER ProposalId
  Passed straight through to promote-lab.ps1.
#>

param([Parameter(Mandatory = $true)][string]$ProposalId)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "promote-lab.ps1"
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Start-Process -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath, "-ProposalId", $ProposalId) `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "promote-lab-spawn.log") `
  -RedirectStandardError (Join-Path $logDir "promote-lab-spawn.err.log")
