# Jarvis

An autonomous business operating system for turning goals into missions, campaigns,
content, decisions, automations, tasks, and measurable deliverables from one place.

## Product flow

- **Daily briefing** — opens with what changed, what is blocked, what is ready to review,
  and the most useful next move.
- **Missions** — keep an outcome, target date, next action, plan, runs, and deliverables
  together. “Advance with Jarvis” launches a run with that context already attached.
- **Mission autopilot** — successful mission runs complete their linked step, capture
  document-style artifacts as draft deliverables, and propose a reviewable progress update,
  next action, and blocker instead of silently changing the mission.
- **Decision inbox** — permission prompts explain the proposed action, its scope, likely
  consequence, recovery options, and whether approval applies only once.
- **Automation rehearsal** — simulates the next run times and checks prerequisites without
  executing the automation.
- **Evolution Center** — tracks product gaps through observation, planning, isolated Lab
  builds, verification, and review. Each proposal carries user value, evidence, risk, and a
  rollback plan; production promotion remains gated until atomic deploy and rollback exist.
- **Campaigns + Content Studio** — turns an objective, audience, offer, approved channels,
  and success metric into a coordinated content pipeline. Jarvis generation runs return
  structured drafts directly into Idea → Draft → Review → Scheduled → Published → Measured,
  with durable run evidence and channel guardrails. Reviewed X content can be published
  immediately or dispatched from the calendar; both routes use the same one-time approval,
  duplicate detection, platform cap, and confirmed-action ledger.
- **Customer Operations** — unifies durable identity and conversation history across an
  embeddable website chat, received email, X direct messages, Facebook Messenger, and
  Instagram Messaging. Jarvis can answer routine messages automatically under explicit
  per-channel, business-hours, confidence, and reply-count controls; sensitive language,
  unsupported commitments, and delivery failures remain in human review. Signed webhook
  verification, event idempotency, real provider delivery status, escalation, follow-up
  tasks, and relationship notes all live in the same real-time queue.
- **Durable memory** — every non-isolated Jarvis turn automatically reflects on new
  preferences, business facts, decisions, relationship details, and stable facts before it
  finishes. Qualified memories enter future runs immediately; turns with nothing durable
  still leave a visible reflection receipt instead of fabricating a memory. The Memory page
  shows source runs, adds and archives facts, and stays current over the shared event stream.
  Focused isolated generators are marked memory-protected so generated copy cannot become
  personal memory.

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

## Backing up Jarvis data

Settings → Backup & recovery can also download a consistent SQLite snapshot containing
tasks, schedules, settings, notifications, sessions, and transcripts. Keep both files:
the data snapshot preserves Jarvis state, while the passphrase-protected credential backup
is what makes platform credentials portable to another machine.

Restore a downloaded data snapshot with:

```
.\scripts\restore-data.ps1 -BackupPath C:\path\to\jarvis-data-YYYY-MM-DD.db
```

The script stops the orchestrator, keeps a timestamped safety copy of the current database,
restores the selected snapshot, and starts the service again.

## API access

The orchestrator requires a bearer token on every request. It is generated on first
start as `jarvis.token` beside `jarvis.key` (never committed), and the dashboard reads
it automatically — there is nothing to configure.

The point is not remote access; both services bind to `127.0.0.1`. It is that any web
page you happen to visit can issue a request to a loopback port, and CORS blocks reading
the response but not the request taking effect. Requests are also refused outright if
they carry a browser `Origin` other than the dashboard's, so a stolen token still does
not let another site drive the service.

`/health`, `/shutdown`, `/widget/*` (embedded on customer sites) and `/webhooks/*`
(authenticated by provider signature) do not take the token.

To call the API yourself:

```
curl -H "Authorization: Bearer $(cat apps/orchestrator/jarvis.token)" \
  http://127.0.0.1:4317/agents
```

## Connections

The Connections page walks you through linking a platform: what to create, where to click,
which values to copy, then a live test that confirms the credentials actually work.
Credentials are encrypted at rest with a key generated on first run (`jarvis.key`, never
committed) and are never returned to the browser.

Once a platform is connected and passing its test, sessions get tools for it
(`post_to_x`, `post_to_slack`, `post_to_discord`, `send_email`). Every outbound action
pauses for your approval first, where you can edit the draft before it sends.

### Slack agent chat

Slack is also a real-time front door to the same continuous agent conversations used by
the dashboard. It uses Slack Socket Mode: the local orchestrator opens an outbound WebSocket,
so no tunnel, public webhook, or remote Jarvis server is required. Configure the two tokens
on Connections → Slack and leave the orchestrator running.

- Mention the Jarvis app in a channel or send it a direct message.
- Send `agents` to list the active agents.
- Write `Growth Lead: draft three posts` to select an agent by name. The Slack thread stays
  bound to that agent afterward, and the turn is appended to that agent's normal Jarvis chat.
- If a tool needs approval, Slack tells you to decide in the local dashboard and posts the
  completed answer back into the same thread afterward.
- Use the optional Slack user-ID allowlist to restrict who can operate your agents.

Inbound event IDs are deduplicated across reconnects. Tokens remain encrypted in the local
SQLite database; decrypted values are never returned by the API.

## Customer channels

Customer Operations → Controls owns customer-service autonomy and website chat setup.
Autonomy starts off, email/social auto-replies start off, and website replies are eligible
only after the master switch is enabled. Copy the embed snippet from that screen or open
the included `/widget/demo` page to test the complete customer experience.

Inbound provider routes are:

- Resend: `/webhooks/resend` with an `email.received` webhook and its signing secret.
- X Account Activity: `/webhooks/x` for CRC verification and direct-message events.
- Facebook Messenger: `/webhooks/facebook`.
- Instagram Messaging: `/webhooks/instagram`.

Provider webhooks require a public HTTPS callback. Do not expose the full local API;
configure a reverse proxy or tunnel to publish only `/webhooks/*` and `/widget/*`, then put
the public site origins in Customer Operations → Controls. Resend retrieves the received
email body after verifying the event; Meta and X payload signatures are checked against
the exact raw request body. Duplicate provider event IDs are ignored.

## Configuration

- `apps/orchestrator`: `HOST` (default `127.0.0.1`), `PORT` (default `4317`), `WEB_ORIGIN` (default `http://localhost:3000`,
  used for CORS), `JARVIS_DB_PATH` (default `apps/orchestrator/jarvis.db`)
- `apps/web`: `NEXT_PUBLIC_ORCHESTRATOR_URL` in `apps/web/.env.local` (default `http://localhost:4317`)

## Data

SQLite database at `apps/orchestrator/jarvis.db` (git-ignored) holds missions, campaigns,
content, customers, conversations, reply drafts, deliverables, durable memories, sessions,
their full event/transcript log, tasks, schedules, and settings. Delete the file to reset.

## Billing

Sessions run through your existing Claude Code login, so they draw on your Claude
subscription's included usage rather than metered per-token API billing. Heavy use can hit
your plan's rate limits, but does not produce a separate bill. Setting `ANTHROPIC_API_KEY`
in the orchestrator's environment would override subscription auth and switch you to
pay-per-token — leave it unset.

## Known limitations

- Single local user, no auth. Both services bind to `127.0.0.1`; do not override the host
  to expose them without adding authentication first.
- Restarting the orchestrator interrupts any in-flight sessions; they can't be reattached
  mid-execution (shows as `interrupted` in the sessions list).
- Automations only fire while the orchestrator process is running. There's no wake-from-sleep
  or system-level trigger — leave it running (e.g. start it at login) for morning schedules.
- Idle sessions are closed after 30 minutes to release their Claude Code subprocess.
  Follow-ups transparently resume from the stored Claude session ID.
- Detailed transcripts follow the retention setting and redundant streaming deltas are
  compacted hourly. Individual persisted events are capped at 64 KB.
