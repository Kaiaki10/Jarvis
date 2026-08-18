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

### medium — Slack and Discord tools are still text-only
`post_to_slack` and `post_to_discord` send text only. X now supports attaching an
image from the watched folder; the same could be offered for the other platforms,
which use simpler single-request uploads.

### medium — The web app has no tests
The orchestrator has coverage. `apps/web` has none — no component tests, no test for
the store's single-EventSource invariant, which is easy to regress by accident.
Playwright is installed in `apps/web/package.json` but no `*.test.ts` or `*.spec.ts`
files exist anywhere under `apps/web`.

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

### medium — Notifications table grows without bound
The `notifications` table has no pruning. Old notifications accumulate forever — a
system running for a year would have tens of thousands of rows. `listNotifications` caps
the API response at 100, but the full history stays in SQLite and slows queries.
Notifications are deleted when their linked session is deleted (`repo.ts:583`), but
sessions themselves are only pruned by event retention, not guaranteed to be removed.

### medium — Platform actions ledger grows without bound
`platform_actions` records every billable action taken (posts, emails, etc.) and has no
pruning. The table is used for daily spend caps (`spendGuard.ts:35-42`) and duplicate
detection within a 30-day window (`spendGuard.ts:77-88`), so only rows older than 30
days are technically stale. A busy automation could write thousands of rows per month,
and nothing ever removes them.

### medium — Foreign keys are not enforced
`db.ts` never enables `PRAGMA foreign_keys = ON`, so the `REFERENCES sessions(id)`
constraint in `session_events` is advisory only. Without enforcement, inserting an event
with a nonexistent session_id would succeed silently. `deleteSession` works around this
manually at `repo.ts:576-580` by deleting events first, then clearing backreferences in
scheduled_tasks, but the lack of enforcement means any future table referencing sessions
must remember to do the same or risk orphaning rows.

## Closed

- **2026-08-18** EventSource has no error handler — closed by automatic reconnection with
  exponential backoff (1s → 30s max) in `apps/web/src/lib/store.tsx:150-158`. The global
  EventSource now recovers from orchestrator restarts or network drops without manual
  refresh. Verified in code: onerror closes the source, schedules reconnect with
  increasing delay, and the open listener resets the delay on success.
- **2026-08-18** Jarvis could not post images — closed by a watched images folder
  plus the X v2 chunked upload (initialize/append/finalize). Verified live: INIT and
  APPEND both succeeded against the real API and only FINALIZE stopped, on account
  credits. The v1.1 endpoint used first was deprecated in March 2025 and answers a
  correct request with "media type unrecognized", which reads like a bad file.
  Path traversal is blocked by construction and covered by tests.
- **2026-08-18** No outbound action had ever succeeded end to end — CLOSED. Jarvis
  composed and sent a real email to the user via Resend through the whole chain:
  session, MCP tool, encrypted vault credentials, spend guard, approval gate, live
  API. Verified by the tool returning "Email sent" and a billable action landing in
  the ledger. X remains blocked on account credits (HTTP 402), but the outbound
  path itself is now proven.

- **2026-08-18** No spend guardrail on paid platform APIs — closed by a per-platform
  daily action cap (`platforms/spendGuard.ts`, default 25) checked before the outbound
  call, so a blocked action costs nothing, and recorded only on success, so a failed
  request does not consume the budget. Verified live: at a cap of 1 the second Slack
  send was refused before Slack was contacted, and a notification explained why.
- **2026-08-18** `session_events` grew without bound — measured at 96% of rows and
  73% of bytes being redundant `stream_event` deltas. Closed by hourly compaction
  (`db/maintenance.ts`), a 64 KB per-event cap, and configurable retention. Real
  database went 7517 KB → 972 KB with transcripts verified intact. Note: under WAL,
  VACUUM alone reclaims nothing without `wal_checkpoint(TRUNCATE)`, and stats that
  ignore the -wal file understate usage — both were wrong on the first attempt.
- **2026-08-17** A bad working directory crashed the whole orchestrator — the SDK
  rejects asynchronously inside ProcessTransport, which Node turns into a process
  exit, taking every other session and automation with it. Closed by validating cwd
  at launch plus `unhandledRejection`/`uncaughtException` guards. Found by accident
  while testing resume error paths.
- **2026-08-17** Reaped sessions could not be resumed — closed by transparently
  resuming from the stored `claudeSessionId` on follow-up. Verified by teaching a
  session a number, restarting the orchestrator so it left memory entirely, then
  asking for the number back: it answered correctly and the transcript continued in
  the same session row.

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
