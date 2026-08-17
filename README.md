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

## Configuration

- `apps/orchestrator`: `PORT` (default `4317`), `WEB_ORIGIN` (default `http://localhost:3000`,
  used for CORS), `JARVIS_DB_PATH` (default `apps/orchestrator/jarvis.db`)
- `apps/web`: `NEXT_PUBLIC_ORCHESTRATOR_URL` in `apps/web/.env.local` (default `http://localhost:4317`)

## Data

SQLite database at `apps/orchestrator/jarvis.db` (git-ignored) holds sessions, their full
event/transcript log, and tasks. Delete the file to reset.

## Known V1 limitations

- Single local user, no auth — don't expose the orchestrator's port beyond localhost.
- Restarting the orchestrator interrupts any in-flight sessions; they can't be reattached
  mid-execution (shows as `interrupted` in the sessions list).
- No cap yet on concurrent sessions.
