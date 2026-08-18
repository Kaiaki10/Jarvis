# Jarvis gap register

Strategic view of what's missing or weak. Reviewed daily by an automation, which
marks gaps closed, adds genuinely new ones, and promotes small actionable items into
`AUTOMATION_BACKLOG.md`.

This is distinct from the backlog: the backlog holds small work the build job can
finish in one session. This file holds anything larger, riskier, or needing a human
decision.

Severity: **critical** (data loss or silent failure) · **high** (blocks real use) ·
**medium** (real friction) · **low** (polish).

## Open

### high — No outbound action has ever succeeded end to end
Tool registration, gating, editing and rejection are all verified, but no real post or
email has been sent through any platform. Until one is, the send path is unproven.

### medium — Reaped sessions cannot be resumed
Idle sessions are closed after 30 minutes to free their subprocess, after which
follow-ups fail with "session not active". `claudeSessionId` is stored, so `resume`
is feasible but unimplemented.

### medium — `session_events` grows without bound
Every stream event is persisted in full, including large tool outputs. Nothing prunes
it. Fine now; a problem after months of daily automations.

### medium — The web app has no tests
The orchestrator has coverage. `apps/web` has none — no component tests, no test for
the store's single-EventSource invariant, which is easy to regress by accident.

### medium — Missed schedules may stampede
`startScheduler` fires everything overdue on the first tick. If the machine was off
for several days, multiple automations could fire at once and immediately collide with
the concurrency cap. Behaviour under that case is untested.

### medium — No retry on failure
A transient network error fails an automation for the whole day. There is no retry and
no distinction between transient and permanent failure.

### low — Orchestrator API is unauthenticated
Anything that can reach `localhost:4317` can launch sessions and read transcripts.
Acceptable for a single-user local machine; blocks ever exposing it.

### low — Dashboard is desktop-only
The sidebar is a fixed 240px with no responsive collapse, so the UI is unusable on a
phone. Relevant if approvals should be actionable away from the desk.

### low — Credentials are entered by hand
Every platform requires manually copying tokens. Proper OAuth flows would be friendlier
but need a public redirect URL.

### medium — Foreign keys are not enforced
`db.ts` never enables `PRAGMA foreign_keys = ON`, so the `REFERENCES sessions(id)`
constraint in `session_events` is advisory only. Deleting a session would orphan its
events without cascade rules, and invalid session_id values are silently accepted. This
matters if sessions are ever pruned or deleted programmatically.

### medium — EventSource has no error handler
The global EventSource in `apps/web/src/lib/store.tsx:109` opens with no `onerror`
listener. A network blip or orchestrator restart silently breaks the live feed — the UI
shows stale data and never reconnects. User has no indication the dashboard is
disconnected until they refresh manually.

## Closed

- **2026-08-17** Approvals waited forever — closed by a configurable deadline
  (default 4h, `deferredWithTimeout.ts`) that auto-denies with `interrupt`, notifies,
  and frees the session slot. Verified with a 1-minute timeout on a real blocked
  session: auto-denied, file never written, status left `waiting_permission`.

- **2026-08-17** Nothing reached the user when a run needed them — closed by
  `notifications/notifier.ts`: an in-app inbox with an unread badge, plus a Windows
  toast, fired on approval-needed and on failure. Verified by blocking a real session
  and watching the notification, badge, and toast appear. Email delivery is wired but
  unverified until an email platform is connected.

- **2026-08-17** Losing `jarvis.key` destroyed every credential — closed by
  passphrase-protected export/restore (`security/portableBackup.ts`, Settings →
  Backup & recovery). Verified by deleting the key and all connections, restarting
  with a freshly generated key, and recovering from the backup file.
- **2026-08-17** Restarting the service silently kept running old code — the task's
  node child was orphaned and held the port. Closed by `scripts/restart-service.ps1`,
  which kills the port owner before starting.
- **2026-08-17** OAuth 1.0a signing was unverified — closed by a clean-room RFC 5849
  cross-check in `oauth1.vector.test.ts`.
- **2026-08-17** Automations died on logout — closed by S4U principal plus boot trigger.
- **2026-08-17** Sessions could not act on connected platforms — closed by the MCP tool
  layer in `platforms/actions.ts`.

## Notes for the daily review

- Do not restate a gap that is already Open. Sharpen the existing entry instead.
- Evidence beats speculation: cite the file, the behaviour, or the transcript.
- Reporting "nothing new" is a valid and useful outcome.
