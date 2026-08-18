# Jarvis Dashboard

A personal command center for orchestrating Claude Code sessions: launch, watch, and steer
multiple sessions from a web dashboard, plus a simple task list.

## Prerequisites

- Node.js 24+ (LTS)
- Git for Windows (Claude Code's Windows runtime requires `bash.exe` from Git for Windows —
  the SDK will fail with a clear error at session start if it's missing)
- Claude Code credentials already set up on this machine (`~/.claude` from a prior `claude login`),
  or an `ANTHROPIC_API_KEY` environment variable

## Setup

```
npm install
```

## Running

Two processes, both required:

```
npm run dev:orchestrator   # backend on http://localhost:4317 — owns the DB and Claude sessions
npm run dev:web            # frontend on http://localhost:3000
```

Open http://localhost:3000.

## Running automatically at login

Scheduled automations only fire while the orchestrator is running. To have Jarvis
start on its own after a reboot:

```
.\scripts\install-service.ps1
```

This builds both apps and registers two hidden tasks (`Jarvis Orchestrator` and
`Jarvis Dashboard`) that start at boot and at logon, running whether or not you are
signed in. Logs land in `scripts/logs`. Remove them with
`.\scripts\uninstall-service.ps1` — your database and credentials are left alone.

To apply code changes, always use:

```
.\scripts\restart-service.ps1        # add -SkipBuild to restart without rebuilding
```

`Stop-ScheduledTask` on its own is not enough — it orphans the node process, which keeps
holding the port so the old code carries on serving. The restart script kills the port
owner first.

## Backing up credentials

Platform credentials are encrypted with `jarvis.key`, which exists only on this machine.
**Lose it and every stored credential is unrecoverable.** Settings → Backup & recovery
exports them re-encrypted under a passphrase you choose, so the file is safe to store
anywhere the passphrase isn't. Restore works on a fresh machine with a different key.

## Connections

The Connections page walks you through linking a platform: what to create, where to click,
which values to copy, then a live test that confirms the credentials actually work.
Credentials are encrypted at rest with a key generated on first run (`jarvis.key`, never
committed) and are never returned to the browser.

Once a platform is connected and passing its test, sessions get tools for it
(`post_to_x`, `post_to_slack`, `post_to_discord`, `send_email`). Every outbound action
pauses for your approval first, where you can edit the draft before it sends.

## Configuration

- `apps/orchestrator`: `PORT` (default `4317`), `WEB_ORIGIN` (default `http://localhost:3000`,
  used for CORS), `JARVIS_DB_PATH` (default `apps/orchestrator/jarvis.db`)
- `apps/web`: `NEXT_PUBLIC_ORCHESTRATOR_URL` in `apps/web/.env.local` (default `http://localhost:4317`)

## Data

SQLite database at `apps/orchestrator/jarvis.db` (git-ignored) holds sessions, their full
event/transcript log, and tasks. Delete the file to reset.

## Billing

Sessions run through your existing Claude Code login, so they draw on your Claude
subscription's included usage rather than metered per-token API billing. Heavy use can hit
your plan's rate limits, but does not produce a separate bill. Setting `ANTHROPIC_API_KEY`
in the orchestrator's environment would override subscription auth and switch you to
pay-per-token — leave it unset.

## Known limitations

- Single local user, no auth — don't expose the orchestrator's port beyond localhost.
- Restarting the orchestrator interrupts any in-flight sessions; they can't be reattached
  mid-execution (shows as `interrupted` in the sessions list).
- Automations only fire while the orchestrator process is running. There's no wake-from-sleep
  or system-level trigger — leave it running (e.g. start it at login) for morning schedules.
- Idle sessions are closed after 30 minutes to release their Claude Code subprocess. After
  that, follow-ups fail; resuming a closed session isn't implemented yet.
- Session transcripts grow unbounded; verbose tool output is stored in full.
