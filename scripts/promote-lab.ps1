<#
.SYNOPSIS
  Promotes a reviewed Jarvis Lab proposal to production: merges its branch,
  rebuilds, restarts, verifies with a real session, and automatically rolls
  back to a pre-promotion snapshot if anything along the way doesn't come
  back healthy.

.DESCRIPTION
  Spawned detached by the orchestrator's POST /evolution/proposals/:id/promote
  route rather than run in-process, because the process that starts a
  promotion is not the one still running by the time its outcome is known —
  restart-service.ps1 kills and replaces it partway through. Everything after
  that point (verification, rollback, recording the outcome) has to survive
  the orchestrator's own restart, which only an external process can do.

  Only the merge step is genuinely destructive before anything is verified;
  a snapshot is taken first so rollback is a file restore, not a second
  build attempt against a state that already proved bad once.

.PARAMETER ProposalId
  The evolution proposal being promoted, so the outcome is recorded against
  the right row.
#>

param([Parameter(Mandatory = $true)][string]$ProposalId)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$orchestratorDir = Join-Path $root "apps\orchestrator"
$webDir = Join-Path $root "apps\web"
$labPath = if ($env:JARVIS_LAB_PATH) { $env:JARVIS_LAB_PATH } else { Join-Path (Split-Path -Parent $root) "jarvis-lab" }
$snapshotDir = Join-Path $root "promotion-snapshots\$(Get-Date -Format 'yyyyMMdd-HHmmss')-$ProposalId"
$logPath = Join-Path $root "scripts\logs\promote-lab.log"

function Write-Log {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Write-Host $line
  Add-Content -Path $logPath -Value $line
}

function Record-Outcome {
  param([string]$Stage, [string]$Detail)
  & node (Join-Path $orchestratorDir "dist\scripts\recordPromotionOutcome.js") $ProposalId $Stage $Detail
}

New-Item -ItemType Directory -Force -Path $snapshotDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null

try {
  if (-not (Test-Path $labPath)) { throw "Jarvis Lab worktree not found at $labPath." }

  Write-Log "Promoting proposal $ProposalId - snapshotting current state into $snapshotDir"
  & node (Join-Path $orchestratorDir "dist\scripts\backupDatabaseTo.js") (Join-Path $snapshotDir "jarvis.db")
  if ($LASTEXITCODE -ne 0) { throw "Database snapshot failed; nothing was touched." }
  Copy-Item -Recurse -Force (Join-Path $orchestratorDir "dist") (Join-Path $snapshotDir "orchestrator-dist")
  # robocopy, not Copy-Item: .next/cache is Turbopack's build cache, tens to
  # hundreds of MB, worthless for serving the app and not needed to restore
  # it — found by accident when one rehearsal snapshot came out to 405MB.
  # /XD excludes it reliably; Copy-Item -Exclude does not do this dependably
  # with -Recurse. Exit codes 0-7 are robocopy success; 8+ is a real failure.
  robocopy (Join-Path $webDir ".next") (Join-Path $snapshotDir "web-next") /E /XD cache /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Snapshotting the dashboard build failed (robocopy exit $LASTEXITCODE)." }
  $preSha = (git -C $root rev-parse HEAD).Trim()
  Set-Content -Path (Join-Path $snapshotDir "pre-sha.txt") -Value $preSha -NoNewline

  $labBranch = (git -C $labPath branch --show-current).Trim()
  if (-not $labBranch) { throw "Could not determine the Jarvis Lab worktree's branch." }
  Write-Log "Merging $labBranch into master ($preSha)..."
  $mergeOutput = git -C $root merge --no-edit $labBranch 2>&1
  $mergeOutput | ForEach-Object { Write-Log "  $_" }
  if ($LASTEXITCODE -ne 0) {
    git -C $root merge --abort 2>&1 | Out-Null
    throw "Merge of $labBranch failed or had conflicts; nothing was built or restarted."
  }
  $postSha = (git -C $root rev-parse HEAD).Trim()

  Write-Log "Building and restarting onto the merged code..."
  & (Join-Path $PSScriptRoot "restart-service.ps1")
  if ($LASTEXITCODE -ne 0) { throw "Build or restart failed after merging $labBranch ($preSha -> $postSha)." }

  Write-Log "Verifying with a real session..."
  & node (Join-Path $orchestratorDir "dist\scripts\verifyPromotion.js")
  if ($LASTEXITCODE -ne 0) { throw "Post-promotion verification failed after merging $labBranch ($preSha -> $postSha)." }

  Record-Outcome "promoted" "Merged $labBranch ($preSha -> $postSha), rebuilt, restarted, and verified with a real session."
  Write-Log "Promoted $ProposalId ($preSha -> $postSha)."
}
catch {
  $reason = $_.Exception.Message
  Write-Log "Promotion failed: $reason"
  Write-Log "Rolling back to the pre-promotion snapshot..."
  try {
    if (Test-Path (Join-Path $snapshotDir "pre-sha.txt")) {
      $preSha = Get-Content (Join-Path $snapshotDir "pre-sha.txt")
      git -C $root reset --hard $preSha 2>&1 | ForEach-Object { Write-Log "  $_" }
    }
    if (Test-Path (Join-Path $snapshotDir "orchestrator-dist")) {
      & (Join-Path $PSScriptRoot "restart-service.ps1") -SkipBuild -RestoreFrom $snapshotDir
      if ($LASTEXITCODE -ne 0) {
        Write-Log "Rollback restart did not report healthy - check scripts/logs and the service manually."
      } else {
        Write-Log "Rolled back and restarted successfully."
      }
    } else {
      Write-Log "No build snapshot existed yet (failed before the merge completed) - nothing to restore."
    }
  } catch {
    Write-Log "Rollback itself failed: $($_.Exception.Message) - service may need manual recovery."
  }
  Record-Outcome "rolled_back" $reason
}
