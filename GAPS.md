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

### high — Attribution and marketing allocation are not autonomous yet
The Campaign Studio now generates, reviews, schedules, and dispatches X content through
the real approval and platform guardrails, but it does not yet ingest impressions, clicks,
leads, or revenue. Without reliable attribution Jarvis cannot safely decide what content
won or shift marketing allocation toward it. The next increment is a normalized measurement
ledger and campaign experiments; allocation must remain bounded and approval-gated until
that evidence is trustworthy.

### medium — Automatic publishing currently supports X only
The publication worker is adapter-based, but LinkedIn, Instagram, Facebook, and blog
connections do not exist yet, and email campaigns need audience/list semantics rather than
a single-recipient send tool. Those channels can still use the content calendar and manual
published state, but only X has confirmed automatic dispatch today.

### medium — Slack and Discord tools are still text-only
`post_to_slack` and `post_to_discord` send text only. X now supports attaching an
image from the watched folder; the same could be offered for the other platforms,
which use simpler single-request uploads.

### low — Orchestrator API is unauthenticated
Anything running locally can launch sessions and read transcripts. Both services now bind
explicitly to `127.0.0.1`, which closes accidental LAN exposure, but authentication is still
required before remote access can ever be supported.

### low — Dashboard is desktop-only
The sidebar is a fixed 240px with no responsive collapse, so the UI is unusable on a
phone. Relevant if approvals should be actionable away from the desk.

### low — Credentials are entered by hand
Every platform requires manually copying tokens. Proper OAuth flows would be friendlier
but need a public redirect URL.

## Closed

- **2026-08-18** Customer channels stopped at a manually maintained inbox — closed with an
  embeddable, token-protected website chat; signed and idempotent Resend, X Account
  Activity, Facebook Messenger, and Instagram Messaging inbound adapters; real outbound
  provider delivery; and one live conversation ledger. Customer-service autonomy is
  fail-closed behind a master switch, per-channel controls, business hours, confidence and
  reply caps, sensitive-claim checks, escalation keywords, and delivery-error review. Live
  email/social activation still requires the user's provider credentials and public HTTPS
  callbacks; that external setup is shown accurately rather than simulated.

- **2026-08-18** Customer service had no operating surface — closed by Customer Operations:
  durable customer identities and conversations, a prioritized unified queue, channel and
  sentiment context, real Jarvis drafting grounded in business context and recent messages,
  review-before-send, live event updates, human escalation with alerts and tasks, follow-up
  tasks, relationship notes, and resolution state. External webhook ingestion remains an
  explicit open gap rather than being represented as already connected.

- **2026-08-18** Dashboard efficiency depended on continuous background polling — closed
  by event-driven invalidation over the existing shared EventSource, cursor-first transcript
  hydration, lightweight stream heartbeats, and turn-scoped recovery only while a reply is
  active. A 15-second command-center load fell from 58 HTTP requests to 19, with zero idle
  HTTP requests after hydration, while task, automation, chat, and restart continuity stayed
  live without changing the visual system.

- **2026-08-18** Jarvis continuity depended on one conversation thread — closed by explicit
  durable memory with source attribution, deduplication, archive control, bounded context
  injection into fresh runs, and local `remember`/`list_memories` tools for the live chat.
  Verified end to end in an isolated real agent run: Jarvis saved a Tuesday preference and
  a new session, with no conversation history, answered “Tuesday.” The UI also refreshed
  its remembered count over the shared event stream without a page reload.

- **2026-08-18** Scheduled campaign content did not execute — closed for X by durable
  publication runs, a due-content worker, immediate “Publish with Jarvis,” one-time outbound
  approval, connected-account and length preflight, daily platform caps, duplicate blocking,
  session-attributed success evidence, and fail-closed reconciliation. Content is marked
  Published only when the platform-action ledger confirms the post actually succeeded.

- **2026-08-18** Campaign work had no first-class operating model — closed by Campaigns +
  Content Studio: durable campaign strategy, mission linking, channel guardrails, approval
  policy, a six-stage content pipeline, manual drafting/editing/scheduling, and real Jarvis
  generation runs that validate structured output before creating reviewable drafts.

- **2026-08-18** Jarvis Lab improvements were invisible and disconnected from the product —
  closed by the Evolution Center: persistent proposals, risk/evidence/rollback records,
  stored autonomy policies, isolated Lab build launches, live run links, and automatic
  advancement to review. Production promotion is visibly gated until its atomic switch and
  health-triggered rollback are real.

- **2026-08-18** Mission state required manual upkeep — successful linked runs now reconcile
  themselves into a completed step, automatically captured draft deliverables, and a
  reviewable mission update with an explicit next action or blocker. Applying the proposal
  changes mission state; dismissing it preserves the existing plan.

- **2026-08-18** Jarvis exposed runs instead of outcomes — closed by first-class Missions
  with success criteria, target dates, progress, next actions, connected tasks, deliverables,
  and one-click mission-aware runs. The command center now leads with a daily briefing,
  approval prompts explain scope/impact/recovery as decisions, and automations can be
  rehearsed without executing them.

- **2026-08-18** Core hardening pass — outbound Jarvis tools can no longer be
  caller-preapproved, dangerous permission modes are rejected, both services bind to
  loopback, request bodies are runtime-validated, foreign keys are enforced, and resumed
  sessions respect the concurrency cap.
- **2026-08-18** Recovery and delivery gaps — EventSource reconnect now reloads
  authoritative state and shows real online/offline status; transcript replay is merged
  without overwriting live events; notification email HTTP failures are logged; outbound
  platform cap and duplicate checks are serialized per platform.
- **2026-08-18** Automation resilience — overdue schedules are paced one per minute and a
  failed scheduled turn gets one bounded retry after five minutes.
- **2026-08-18** Data recovery — Settings can download an online SQLite snapshot of Jarvis
  state, and `scripts/restore-data.ps1` restores it while retaining a safety copy.
- **2026-08-18** Verification baseline — the web app has a component regression test for
  the single-EventSource invariant, lint is clean, and GitHub Actions now enforces tests,
  lint, and production builds.

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
