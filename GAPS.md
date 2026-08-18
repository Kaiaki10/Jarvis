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

### critical — Losing `jarvis.key` makes every stored credential unrecoverable
There is no backup of `jarvis.key` or `jarvis.db`. The key is generated once and
gitignored by design, so a disk failure or an accidental delete permanently destroys
every connected platform's credentials with no recovery path. Needs at least a
documented backup step, ideally an export command.

### high — No notification when something needs a human
An automation that blocks for approval at 07:00 sits untouched until someone opens
the dashboard. Unattended operation is only real if it can reach you — email via the
Resend connection, or a desktop notification.

### high — Approvals wait forever
`canUseTool` returns a promise with no timeout (`sessionManager.ts`). A blocked
session holds its slot indefinitely against the concurrency cap, and an unattended run
can stall silently for days. Needs a timeout with a sensible default action (deny).

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

- **2026-08-17** OAuth 1.0a signing was unverified — closed by a clean-room RFC 5849
  cross-check in `oauth1.vector.test.ts`.
- **2026-08-17** Automations died on logout — closed by S4U principal plus boot trigger.
- **2026-08-17** Sessions could not act on connected platforms — closed by the MCP tool
  layer in `platforms/actions.ts`.

## Notes for the daily review

- Do not restate a gap that is already Open. Sharpen the existing entry instead.
- Evidence beats speculation: cite the file, the behaviour, or the transcript.
- Reporting "nothing new" is a valid and useful outcome.
