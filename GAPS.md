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

### high — Cross-channel attribution (organic + leads + revenue) still has no evidence to work from
Paid Growth now has a real measurement ledger and a declared-experiment mechanism for
comparing paid campaigns against each other (closed below), but Campaign Studio still has
no structured organic engagement data — `social_metrics` exists but is unpopulated, blocked
on X's metrics API returning HTTP 402 "credits depleted" rather than a code gap — and no
customer or lead ever carries an acquisition channel or revenue figure; `customers` has no
such column and no inbound path (webhook or website widget) captures a referrer or UTM.
Until at least one of those exists, "shift the full marketing allocation toward what's
winning" has no organic or lead-revenue evidence to act on — only the paid-vs-paid
comparison closed below is real today. Tracked links remain a deliberate non-goal per
`WORKFLOW_PLAN.md`; whether that still holds is worth reconfirming against the live
`BUSINESS_CONTEXT.md` before anyone builds click tracking to close this the rest of the way.

### medium — Automatic publishing currently supports X only
The publication worker is adapter-based, but LinkedIn, Instagram, Facebook, and blog
connections do not exist yet, and email campaigns need audience/list semantics rather than
a single-recipient send tool. Those channels can still use the content calendar and manual
published state, but only X has confirmed automatic dispatch today.

### low — Credentials are entered by hand
Every platform requires manually copying tokens. Proper OAuth flows would be friendlier
but need a public redirect URL.

## Closed

- **2026-08-26** Per-agent authorization is closed: the shared master token used
  to prove only "this is the dashboard," not *which* agent the caller was entitled
  to act as — anyone holding it could deliberately name any valid agent, since
  `scopedAgentId` only ever checked that the id existed. Closed by short-lived,
  per-agent scoped tokens (`agent_tokens`, mirroring `operator_sessions`'s own
  shape) minted through the same-origin `/api/token` route, which already
  reliably resolves the operator's passkey session — the direct
  browser-to-orchestrator calls never could, being cross-port. A per-agent token
  is now valid *only* for the one agent it was minted for; it is explicitly
  refused for an unscoped request too, since an unscoped read can return every
  agent's data. The master token is no longer sufficient on its own for any
  agent-scoped route — confirmed by grep that no in-process orchestrator module
  (scheduler, Slack bridge, paid-growth executor, customer webhooks, notifier)
  ever called its own HTTP API with the master token plus an `agentId`, so only
  the dashboard needed migrating, and this same change does it. Room
  conversations (`conversationRunner.ts`) run entirely in-process and never
  touch this layer at all.

  Two design shortcuts were deliberately rejected rather than taken: per-*operator*
  grants (moot — there is exactly one operator per install; extra passkeys are
  just extra devices for that same person) and forwarding the operator-session
  cookie cross-port to the orchestrator directly (this would have reintroduced
  the exact cross-origin-cookie fragility this codebase already hit and fixed
  once — see the 2026-08-20 entries below on Firefox Total Cookie Protection and
  the IPv6-loopback cookie bug). Remote access stays out of scope, as before:
  both services still bind to `127.0.0.1`.

  Verified live in `jarvis-lab` on scratch ports, not just typed and tested —
  this repo's first real HTTP-layer integration test (`server.integration.test.ts`,
  booting the actual Express app on an ephemeral port) covers the full
  authorization matrix, and a live browser run confirmed real agent-switching
  mints and uses a distinct bearer token per agent (16 real requests captured
  carrying the new agent's own token), the shared global event stream survives
  the switch untouched (opened once, no reconnect), and `/api/token` correctly
  401s with no valid operator session in login-required mode — for both the
  master-token and the per-agent-mint code paths.

- **2026-08-25** The paid-only slice of the attribution gap is closed: a `measurement_facts`
  append-only ledger (mirrors `social_metrics`'s one-row-per-observation design) now records
  real ad-platform revenue, spend, impressions, clicks, and conversions from both the
  15-minute auto-sync and the manual entry path, and a declared `campaign_experiments`
  concept (named variants, an explicit hypothesis, minimum-conversions-and-days-running
  thresholds) replaces `engine.ts`'s old always-on heuristic that compared any two unrelated
  active campaigns by ROAS with no context. Concluding an experiment proposes the existing
  `reallocate` decision kind, tagged with the experiment it came from, through the same
  approval gate in `decidePaidGrowthRecommendation` — no new execution path, no auto-apply.
  Organic and lead/revenue evidence remain out of scope; see the sharpened entry above for
  what's still open.

  Verified live in the `jarvis-lab` worktree on scratch ports, not just typed and tested:
  doing so found and fixed two real bugs a running app surfaced that unit tests hadn't.
  The manual performance-update endpoint never wrote to the new ledger — only the auto-sync
  path did, and auto-sync needs live ad-platform credentials nobody has yet, so the one path
  actually testable today silently produced zero history. And `PaidGrowthCenter`'s two
  dialogs (`CreatePaidCampaign`, `PerformanceEditor`) each kept an independent numeric `key`
  counter from `useDialog()`; as literal JSX siblings they eventually land on the same
  integer, which tripped React's duplicate-key warning once both had been opened the same
  number of times in the live session. Also fixed, found incidentally while already in the
  same files: `api.ts` called `/paid-growth/campaigns/...` for every Paid Growth mutation
  (create, sync, launch, manual update) while the orchestrator only ever registered
  `/paid-growth/workflows/...` — a live 404 on every one of those UI actions, invisible until
  now because zero campaigns existed yet to click those buttons on.

- **2026-08-24** "Dashboard is desktop-only" was already stale when reviewed: `AppShell.tsx`
  has had a full off-canvas mobile sidebar since `2c1c18b` ("v3.0 Flagship 1: reach Jarvis
  anywhere") — below `lg` the rail becomes a hamburger-triggered drawer with a click-away
  backdrop and auto-close on navigation, not the fixed 240px column this gap described.
  Verified live rather than trusting the diff: an isolated preview (jarvis-lab worktree, so
  as not to touch the live checkout's `.next/`) at a real 390px phone width (not the 900px
  already swept for a different item) showed the sidebar fully off-canvas by default (zero
  horizontal overflow across / , /operate, /missions, /tasks, /conversations,
  /notifications, /under-the-hood), the hamburger opening it correctly, and a nav click both
  navigating and closing the drawer. No code change needed.

- **2026-08-24** `post_to_slack` and `post_to_discord` could only send text; X was the
  only platform that could attach an image from the watched folder. Both now accept an
  optional `imageFile`, reusing the same `list_available_images` / images-folder
  convention as X. Discord's upload is a single multipart request (`payload_json` +
  `files[0]`), no new scope needed beyond Send Messages/Attach Files. Slack needed real
  research, not the "simpler single-request" upload this gap assumed: `files.upload`
  was retired 2025-11-12, so it now goes through the current three-call flow
  (`files.getUploadURLExternal` → raw-byte POST → `files.completeUploadExternal`, the
  last of which also carries the channel and caption). That requires a `files:write`
  bot scope the connection wizard didn't request before — added, with a reinstall
  warning like the existing scope changes. It also only accepts a real channel ID, not
  a `#name` the way `chat.postMessage` does; the tool description says so rather than
  silently failing on a plausible-looking argument. Verified against Slack's and
  Discord's current API docs (no live workspace credentials available here to test
  against); added `actions.test.ts` — previously nonexistent for this file — covering
  both new code paths against mocked `fetch`: correct request shapes for the happy
  path, and each documented failure mode (refused upload URL, rejected byte upload,
  refused completion, a path-traversal filename). Full suite green across three
  consecutive runs.

- **2026-08-20** After the IPv6-loopback fix, the same user's Firefox still
  bounced straight back to `/login?from=%2F` on a fresh tab, even though the
  passkey ceremony kept succeeding server-side every time (a new valid
  session, confirmed via direct DB inspection, on every attempt) — but that
  session was never touched again afterward, meaning the browser's very next
  request never carried the cookie at all. Root cause: the login page called
  the orchestrator directly, cross-port (`:3000` → `:4317`), with
  `credentials: "include"` — and a session cookie set by a *cross-origin*
  fetch response is exactly what browsers' cross-site cookie protections
  (Firefox's Total Cookie Protection foremost, but this isn't Firefox-only)
  are designed to restrict, in ways that depend on privacy settings this app
  has no way to detect. Two clean-profile Playwright reproductions of the
  same cross-origin flow both worked, which is why this took two rounds to
  find — the failure mode is specific to real-world privacy configurations,
  not the mechanism in the abstract.

  Closed by removing the cross-origin dependency entirely rather than
  chasing browser-specific settings: `apps/web/src/app/api/auth/[...path]/route.ts`
  proxies `/api/auth/*` to the orchestrator's `/auth/*` server-side (Node
  fetch, never subject to browser cookie policy at all — the same reason
  `proxy.ts`'s own session check was always reliable), relaying the
  `Set-Cookie` header back as its own same-origin response. The browser now
  only ever talks to its own origin for auth, making the session cookie an
  ordinary first-party cookie — the most universally-supported cookie
  mechanism there is, not a special case any privacy policy singles out.
  Verified live: full registration through the new proxy in Chromium, then a
  fresh Firefox context honoring that exact session without bouncing to
  `/login`.

- **2026-08-20** A real user's Firefox session stayed stuck after a *working*
  login — the passkey ceremony succeeded, the redirect to `/` fired correctly
  (confirmed: URL bar changed, no /login in it), but the dashboard itself
  never became usable. Diagnosed by proving each layer live rather than
  guessing: `/auth/session` validated the real session correctly with `curl`,
  two independent Firefox reproductions of the cookie-setting flow both
  worked, and `Test-NetConnection ::1 -Port 4317` finally isolated it —
  nothing was listening on the IPv6 loopback address at all, only
  `127.0.0.1`. `localhost` resolves to both `::1` and `127.0.0.1` on this
  machine; a browser that tries IPv6 first for background calls (the
  dashboard's EventSource connection, its data fetches) has no guaranteed-fast
  fallback to IPv4, while `proxy.ts`'s own server-to-server fetch (Node,
  not a browser) was never subject to this at all — which is exactly why the
  redirect worked but nothing after it did. Closed by also binding a second
  listener on `::1` in `http/server.ts` (`HOST_V6`), removing the race
  instead of depending on every browser's Happy Eyeballs implementation.
  Verified live: both `[::1]:4317` and `127.0.0.1:4317` now answer real
  requests.

- **2026-08-20** The very first live passkey registration got stuck showing
  "waiting for your passkey" indefinitely, even though it had actually succeeded —
  `/auth/status` showed `hasOperator: true` server-side the whole time. The
  registration ceremony completed correctly; only `afterLogin()`'s
  `router.replace(...)` failed to actually land the browser on the dashboard.
  Root cause: this was caught live on the real deployment (`next start`,
  production build), not in the `next dev` scratch harness used to verify
  Flagship 1 — Next's client Router Cache can serve a cached pre-login redirect
  result on a soft client-side transition in production specifically, something
  dev mode doesn't reproduce. Closed by replacing `router.replace()` with
  `window.location.href` in `afterLogin()` — a real page load re-runs `proxy.ts`
  fresh rather than trusting a cached routing decision, which is the right
  behavior for an unauthenticated→authenticated transition anyway. Verified by
  redeploying live and confirming login completed normally afterward.

- **2026-08-20** Evolution Center could propose and build improvements in Jarvis Lab
  but production promotion still required a manual merge, rebuild, and restart —
  `evolutionReadiness()` had hardcoded `promotionEngineReady`/`automaticRollbackReady`
  to `false` since the feature existed, with its own bootstrapped proposal #1 naming
  this as the gap. Closed by `scripts/promote-lab.ps1`: snapshot (online DB backup plus
  current `dist`/`.next`) → merge the reviewed Lab branch → rebuild and restart → a real
  agent session as a smoke test → record the outcome, or restore the snapshot and record
  `rolled_back` on any failure. Both paths verified live, not just read: a real trivial
  proposal promoted successfully end to end, and a separate run with verification
  deliberately forced to fail rolled back automatically — reset the merge, restored the
  pre-promotion database and build, restarted, and came back healthy on its own.
  `automaticRollbackReady` only flipped true after that second, adversarial test, per
  this feature's own standard that a green badge must be evidence.

  Three unrelated bugs found only by rehearsing for real, not by reading the code:
  `LAB_PATH`'s default path resolution was off by a directory level (`labAvailable` had
  likely been silently `false` in production this whole time); the real `jarvis-lab`
  branch was stale enough that its own daily automation had been stuck re-logging the
  same unresolved `GAPS.md` conflict since 2026-08-19, unable to proceed by its own
  rule (never merge, only rebase, stop on conflict) — resolved by a human merge, since
  a three-way check showed only two files genuinely conflicted, not the ~171 a naive
  branch diff suggested; and the promotion spawn itself failed two different ways in
  production (`detached: true` never actually started the process at all, no trace
  anywhere; without it, the process ran but was killed mid-restart by its own attempt
  to stop the scheduled task it was still part of, leaving the live service down with
  no automatic recovery) — closed with a `Start-Process`-based launcher script that
  reliably escapes the task's process tree, which a raw spawn did not.

- **2026-08-20** Room conversations (agent-to-agent) could never use a tool needing
  approval — the per-turn timeout (5 minutes, `conversationRunner.ts`) always fired
  before the 4-hour default approval timeout could, force-interrupting the turn.
  Reproduced live on the first real room, which asked its agents to read two files
  first: the `Read` calls both got force-interrupted mid-approval, and the room died
  with "Jarvis did not reply" after spending real turns and cost with nothing recorded.
  Closed by pre-approving `Read`/`Glob`/`Grep` specifically for room sessions; Bash,
  Edit, Write, and platform actions remain gated exactly as designed in `V2_PLAN.md`.

- **2026-08-20** The new Slack agent bridge shipped with an open-by-default allowlist —
  the setup UI invited leaving "Allowed Slack user IDs" blank to "allow anyone in the
  installed workspace," and a Slack turn gets the same tool access as the dashboard (full
  agent permission mode, no per-message approval). Any workspace member, not just the
  operator, could have driven an agent and read local files through it. Found by security
  review before the branch's first push to the now-public repo, closed before push by
  making the allowlist a required field and refusing to start the Socket Mode connection
  without at least one allowed Slack user ID (`slackAgentBridge.ts`).

- **2026-08-19** Multi-agent data isolation was incomplete outside the original dashboard
  roots — closed by ownership on campaigns, paid growth, customers, evolution, and
  notifications; parent-joined filtering for every child collection; ownership checks on
  mutations; agent-scoped memory reflections; session-attributed alerts; full workspace
  refresh on agent switch; and repository/store regression tests. System schedulers and
  maintenance still intentionally use unscoped repository calls so unattended work spans
  every agent. Per-agent caller authorization remains the separate open gap above.

- **2026-08-19** The orchestrator API was unauthenticated — closed by a generated
  `jarvis.token` presented as a bearer token on every request, plus a server-side origin
  guard. The attack that mattered was not remote: any web page the user visits can POST to a
  loopback port, and CORS blocks reading the reply but not the request landing, so a drive-by
  could launch sessions and spend real credentials. Verified live at both layers — an
  unauthenticated call is refused, and a call carrying a *stolen* token from a foreign origin
  is still refused. `/widget` (third-party by design), `/webhooks` (payload-signed), `/health`,
  and `/shutdown` stay exempt; `/shutdown` because the restart script's fallback can fail
  against an S4U-protected child, and the origin guard already puts it out of a browser's
  reach. The dashboard fetches the token from its own server rather than a `NEXT_PUBLIC_`
  variable, so it never enters the static bundle. Per-agent authorization is a separate,
  still-open gap.

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
