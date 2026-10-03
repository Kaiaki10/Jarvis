<#
.SYNOPSIS
  Publishes Jarvis's chat widget and provider webhooks on a public hostname.

.DESCRIPTION
  The orchestrator listens on loopback only. Website visitors (the chat widget)
  and providers (Stripe, Resend, X, Meta webhooks) need to reach it from the
  internet, so this gives Jarvis its own Cloudflare tunnel:

    https://<Hostname>/widget/...    -> 127.0.0.1:4317
    https://<Hostname>/webhooks/...  -> 127.0.0.1:4317
    anything else                    -> 404 at Cloudflare's edge

  Nothing else is routed. /shutdown, the API, and the dashboard stay local. The
  orchestrator enforces the same rule itself (http/publicEdge.ts), so a mistaken
  edit here still can't publish them.

  It's a separate tunnel from the HussleSol site's, on purpose: Jarvis can be
  restarted or reconfigured without touching that site, and vice versa.

  Prerequisite: `cloudflared tunnel login` has been run (cert.pem exists) for
  the zone that owns <Hostname>. Re-running is safe: it reuses the tunnel,
  rewrites the config, and replaces the scheduled task.
#>

param(
  [string]$Hostname = "jarvis.husslesol.com",
  [string]$TunnelName = "jarvis"
)

$ErrorActionPreference = "Stop"

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { $cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe" }
if (-not (Test-Path $cloudflared)) { throw "cloudflared was not found. Install it first." }

$cfDir = Join-Path $env:USERPROFILE ".cloudflared"
if (-not (Test-Path (Join-Path $cfDir "cert.pem"))) {
  throw "No Cloudflare login found. Run: cloudflared tunnel login"
}
$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Get-TunnelId {
  $tunnels = & $cloudflared tunnel list --output json | ConvertFrom-Json
  ($tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1).id
}

$id = Get-TunnelId
if (-not $id) {
  Write-Host "Creating tunnel '$TunnelName'..." -ForegroundColor Cyan
  $ErrorActionPreference = "Continue"
  & $cloudflared tunnel create $TunnelName 2>&1 | Out-Host
  $createExit = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($createExit -ne 0) { throw "Could not create the tunnel." }
  $id = Get-TunnelId
}
$credentials = Join-Path $cfDir "$id.json"
if (-not (Test-Path $credentials)) {
  throw "Tunnel '$TunnelName' exists but its credentials file ($credentials) is missing on this machine. Delete the tunnel in the Cloudflare dashboard and re-run."
}

$config = Join-Path $cfDir "$TunnelName.yml"
@"
# Written by jarvis/scripts/install-tunnel.ps1. Edit that script, not this file.
tunnel: $id
credentials-file: $credentials

ingress:
  # Only the chat widget and signed provider webhooks are public.
  - hostname: $Hostname
    path: ^/(widget|webhooks)(/|$)
    service: http://127.0.0.1:4317
  - hostname: $Hostname
    service: http_status:404
  - service: http_status:404
"@ | Set-Content -Path $config -Encoding ascii

$ErrorActionPreference = "Continue"
& $cloudflared tunnel --config $config ingress validate 2>&1 | Out-Host
$validateExit = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($validateExit -ne 0) { throw "The generated tunnel config is invalid: $config" }

Write-Host "Routing $Hostname to the tunnel..." -ForegroundColor Cyan
# --config pins this tunnel's own config, and the tunnel is named by id. Without
# them cloudflared falls back to ~/.cloudflared/config.yml, which names the
# HussleSol tunnel, and silently points the record there instead (seen on the
# first run of this script). --overwrite-dns repairs a record left pointing at
# another tunnel. cloudflared logs to stderr even on success, which under
# "Stop" PowerShell 5.1 would throw, so it's judged by exit code instead.
$ErrorActionPreference = "Continue"
$route = (& $cloudflared tunnel --config $config route dns --overwrite-dns $id $Hostname 2>&1) -join " "
$routeExit = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($routeExit -ne 0) { throw "Could not create the DNS record for ${Hostname}: $route" }
if ($route -notmatch [regex]::Escape($id)) { throw "The DNS record for $Hostname did not land on tunnel $id. cloudflared said: $route" }
Write-Host "  $route"

# Same shape as install-service.ps1: hidden PowerShell wrapper for log capture,
# boot + logon triggers, S4U so it runs without an interactive session.
$log = Join-Path $logDir "tunnel.log"
$inner = "& '$cloudflared' tunnel --no-autoupdate --config '$config' run $TunnelName *>> '$log'"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$inner`""
$triggers = @(
  New-ScheduledTaskTrigger -AtStartup
  New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew

$taskName = "Jarvis Tunnel"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null
} catch {
  throw "Could not register the '$taskName' task: $($_.Exception.Message). An S4U task (runs without a logged-in session) needs an elevated PowerShell: right-click PowerShell, Run as administrator, and run this script again. The tunnel and DNS record above are already in place."
}
# Register-ScheduledTask can report some failures without throwing, so confirm.
if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
  throw "The '$taskName' task was not created. Run this script from an elevated PowerShell."
}
Start-ScheduledTask -TaskName $taskName
Write-Host "  registered and started: $taskName" -ForegroundColor Green

Write-Host ""
Write-Host "Public endpoints (allow a minute for DNS):" -ForegroundColor Green
Write-Host "  Widget script : https://$Hostname/widget/customer-chat.js"
Write-Host "  Stripe        : https://$Hostname/webhooks/stripe"
Write-Host "  Resend        : https://$Hostname/webhooks/resend"
Write-Host "  X             : https://$Hostname/webhooks/x"
Write-Host "  Facebook      : https://$Hostname/webhooks/facebook"
Write-Host "  Instagram     : https://$Hostname/webhooks/instagram"
Write-Host "Logs: $log"
