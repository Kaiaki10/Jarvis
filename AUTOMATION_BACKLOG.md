# Jarvis automation backlog

Maintained by the daily self-improvement automation. Highest priority first.
Each run picks **one** item, completes it properly, and records the outcome here.

## How to use this file

- `## Up next` — candidate work, best-first. Keep items small enough for one session.
- `## Design` — visual and usability findings, judged against DESIGN_SYSTEM.md.
  Filed by the critique job, implemented by the polish job. Mark anything that
  breaks a non-negotiable with **(non-negotiable)** so polish takes it first.
- `## Done` — newest first, with the date and a one-line result.
- `## Notes` — anything a future run should know (dead ends, conventions, gotchas).

## Up next

(empty — see Notes for where to look next)

## Design

Judged against DESIGN_SYSTEM.md. Seeded 2026-08-18 from the design system rebuild —
these are things noticed while doing it that were out of scope for that pass.

## Done

- [x] **2026-08-24** (retroactive) Relative timestamps and Cmd/Ctrl+Enter, found already
      shipped while clearing stale "Up next" entries: `5d313d2` added a shared
      `relativeTime()` helper and a "5m ago" badge to the session history list (and
      consolidated `NotificationsList`'s own copy into it), and `SimpleJarvisHome.tsx`
      already binds Cmd/Ctrl+Enter at the whole chat-panel level, not just the textarea,
      so it submits after tabbing to the model picker or voice button too. Neither had
      ever been checked off, so both sat in "Up next" describing work already done.
- [x] **2026-08-24** Loading states: replaced the plain "Loading…" text in nine spots
      across eight components (SessionList, JarvisChat, SimpleJarvisHome,
      SettingsPanel, StripeCardsPanel, SpendBudgets x2, ConnectionWizard,
      CustomerOperationsCenter, CryptoWallet x2 — more than the six originally
      counted) with skeleton placeholders shaped like each surface's real content —
      list rows, chat bubbles, table rows, card grids. New shared `Skeleton`
      primitive in `components/ui/`. Caught and fixed a real bug live rather than
      shipping it blind: the two chat-bubble skeletons used `max-w-*` with no `w-*`,
      which collapses an empty div to zero width — invisible despite "correct"-looking
      markup. Verified against an isolated preview with all API calls delayed 8s to
      hold the loading state long enough to screenshot every site before and after
      the fix.
- [x] **2026-08-24** `ScheduledTasksPanel` disclosure a11y: confirmed with axe-core
      against a live render — hiding the `<details>` marker is cosmetic and doesn't
      affect disclosure semantics, but the row's `<summary>` also nested a Link and
      two buttons, which axe flags as "nested-interactive" (serious). Replaced with a
      plain row plus a dedicated `<button aria-expanded aria-controls>`; violations
      went from 1 to 0. See `9f3c75c`.
- [x] **2026-08-24** `SettingsPanel`/`ConnectionWizard` redesign — already done, not
      newly built: `c5d31b9` ("Give Settings and Connections a shape you can navigate",

- [x] **2026-08-24** `SettingsPanel`/`ConnectionWizard` redesign — already done, not
      newly built: `c5d31b9` ("Give Settings and Connections a shape you can navigate",
      2026-08-23) gave both pages a section rail and sticky headers, which is exactly
      what this item asked for. Verified live against an isolated preview instance —
      the "On this page" rail with an active-section indicator renders correctly at
      1600px. This Design entry predates that commit and was never marked done.
- [x] **2026-08-24** Narrow (900px) viewport sweep: walked all 23 pages the dashboard
      has (the same list `scripts/screenshot-dashboard.mjs` screenshots) against a live,
      isolated preview instance at 900px, measuring `document.documentElement.scrollWidth
      - clientWidth` on each. Zero horizontal overflow anywhere, including `SettingsPanel`
      and `ConnectionWizard` (walked its full multi-step credential form for both Stripe
      and Coinbase, its widest platforms). No fix needed — the concern this item raised
      didn't reproduce. Caveat: checked against fresh/default fixture data, not
      unusually long real content (a very long business-context paste, a long error
      message), which this pass wouldn't catch.
- [x] **2026-08-18** Tool call visibility: `TranscriptEntry` in `SessionTranscript.tsx` was
      silently dropping `tool_use` content blocks. Added a `ToolCallRow` — a wrench icon, a
      humanized label ("Ran npm test", "Read store.tsx"), and a `<details>` disclosure for
      the raw input JSON — following the existing collapsible pattern (visible marker, no
      hidden-marker a11y risk). Verified against a live 53-tool-call session at desktop and
      narrow widths via a port-3100 preview against the running orchestrator: no console
      errors, no overflow, existing text bubbles and permission cards unaffected.
- [x] **2026-08-18** EventSource reconnection: Added automatic reconnection with exponential backoff (1s → 30s max) to `apps/web/src/lib/store.tsx`. The global EventSource now recovers from orchestrator restarts or network drops without manual refresh.
- [x] **2026-08-17** Test suite: Added comprehensive tests for `oauth1.ts` OAuth 1.0a HMAC-SHA1 signing (23 tests covering header format, RFC 3986 encoding, signature construction, parameter sorting, nonce/timestamp generation, and edge cases). All tests passing.
- [x] **2026-08-17** Empty states: Added icons and action links to TodaySchedule, SessionList, and ScheduledTasksPanel. All empty states now follow the pattern from AutomationHealth (icon + message + clickable action).

## Notes

- **2026-08-24**: `src/platforms/actions.test.ts` (new) failed twice on `sendDiscordMessage`'s
  first two tests with a 5s vitest timeout, both times only on the *first* run after the
  file was created — every run since, alone or in the full suite, passed cleanly in ~3s.
  Looked hard for real global-fetch pollution leaking across test files (several other
  files `vi.stubGlobal("fetch", ...)`, all clean up with `afterEach(() => vi.unstubAllGlobals())`)
  and found nothing; treating it as a one-off cold-start cost (fresh TS transform, first
  FormData/fetch resolution) rather than a real bug. If it reappears reproducibly, that
  theory is wrong — look again before dismissing it a second time.
- **2026-08-20** (resolved): the test suite regression noted earlier today — 16 tests
  timing out on a clean tree, traced to parallel test files racing to import `db.ts`
  and initialize SQLite at the same time — is fixed. `apps/orchestrator/vitest.config.ts`
  now sets `fileParallelism: false`. Verified: all 250 tests pass; confirmed by
  reproducing the failure with the fix reverted (16 timeouts) before reapplying it.
- The live Jarvis runs from **compiled output** in your main checkout
  (`dist/` and `.next/`). This worktree is a separate checkout on branch `jarvis/auto`,
  so nothing done here affects the running service until a human merges and rebuilds.
- `npx tsc --noEmit` needs `.next/types` to exist for the web app (`LayoutProps` is
  generated by Next). If typecheck fails with `Cannot find name 'LayoutProps'`, run
  `npx next build` in `apps/web` first.
- Do not bind ports 3000 or 4317 — the live service owns them.
