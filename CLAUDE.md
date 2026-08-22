# Jarvis

A personal command center for orchestrating Claude Code sessions, plus scheduled
automations that run unattended.

## Layout

```
apps/orchestrator   Node/TS service. Owns SQLite, the Claude Agent SDK, the scheduler,
                    platform credentials, and the REST + SSE API on :4317.
apps/web            Next.js dashboard (App Router, Tailwind v4) on :3000. UI only.
packages/shared     Types shared by both. Import as @jarvis/shared.
```

Two processes, deliberately. Next.js route handlers hot-reload and aren't guaranteed
long-lived, which would orphan running sessions and pending permission promises.

## Running

```
npm run dev:orchestrator
npm run dev:web
```

Both also run as Windows Scheduled Tasks in production — see `scripts/install-service.ps1`.
Those run **compiled output** (`dist/`, `.next/`), so editing source does not affect the
live service until someone rebuilds.

## Conventions

- **Never surface cost/dollar figures in the UI.** Sessions run on a Claude subscription;
  the SDK's `total_cost_usd` is an informational token estimate, not a charge. Showing it
  implies a bill that does not exist. It's stored, never displayed.
- **UI components** live in `apps/web/src/components/ui` (`Card`, `Button`, `Badge`,
  `Input`/`Textarea`/`Select`). Compose these; don't hand-roll new button or card styles.
- **Colors come from tokens** in `globals.css` (`--accent`, `--muted`, `--danger`, …) and
  are used via Tailwind classes like `text-muted`, `border-border`. No raw hex in components.
- **All live data flows through one store** (`apps/web/src/lib/store.tsx`) which owns a
  single `EventSource`. Do not open another one — browsers cap ~6 connections per origin
  and per-component streams would starve the app. Consume via the hooks it exports.
- **Icons** are `lucide-react`, `h-4 w-4` at `strokeWidth={1.75}` for most UI.
- Empty states follow the pattern in `AutomationHealth`: icon, short message, action link.

## Session and permission model

- `sessionManager.ts` wraps the SDK's `query()` with streaming input, so sessions stay open
  for follow-ups after a turn ends (`idle`, not `completed`). Idle sessions are reaped after
  30 minutes to release their subprocess.
- Tools that aren't pre-allowed route through `canUseTool`, which pauses the session and
  emits a `permission_request` event for the UI to approve. **When approving, the fallback
  must be the original tool input** — passing `{}` would run the tool with no arguments.
- Outbound platform actions (`post_to_x`, `post_to_slack`, …) are built in
  `platforms/actions.ts` from connected credentials and deliberately left unallowed, so
  every one of them hits the approval gate.

## Credentials

Platform credentials are AES-256-GCM encrypted in SQLite via `security/secretStore.ts`,
keyed by `jarvis.key` (generated on first run, gitignored). **Never return decrypted values
from an API route** — responses carry masked hints only.

## Gotchas

- `npx tsc --noEmit` in `apps/web` needs `.next/types` to exist (`LayoutProps` is generated
  by Next). Run `npx next build` first in a fresh checkout.
- **After moving or renaming a page, `rm -rf .next/dev`.** Next generates route
  validators under `.next/dev/types` that import each page by its old path; they
  are not rebuilt on move, so both `tsc --noEmit` and `next build` fail with
  `Cannot find module ../../src/app/<old-path>/page.js` until that directory is
  deleted.
- `node:sqlite` rows are typed loosely; repo functions cast through `unknown`.
- PowerShell is the shell here. `&&` and `||` are unavailable; backticks are escape
  characters, so pass multi-line git messages via `git commit -F <file>`.
- Ports 3000 and 4317 are owned by the live service. Don't bind them from a worktree.

## Scheduled automations

Automations run unattended from a git worktree at `../jarvis-lab` on branch
`jarvis/auto`. They all follow `AUTOMATION_RULES.md` — read it before doing
automated work. The live service runs compiled output from this directory, so
nothing an automation commits affects it until a human merges and rebuilds.
