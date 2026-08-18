# Jarvis v2 — multiple agents

Today Jarvis is one agent, and nothing in the code says so. Its identity is
spread across global singletons rather than held in a record. v2 gives agents a
first-class existence, isolates their work from each other, and lets two or more
of them hold a conversation.

Written 2026-08-18. This is the plan of record; when reality diverges, change
this file in the same commit and say why.

## What "Jarvis" actually is today

There is no agent concept. The identity lives in four places, all singleton:

| Trait | Where it lives now | Why it blocks v2 |
|---|---|---|
| Persona | `settings.business_context` | One row, so one personality |
| Chat thread | `settings.primary_session_id` | Literally one conversation, globally |
| Memory | `memories` table, no owner column | Every agent would share one brain |
| Working directory | `settings.chat_working_directory` | One |

Platform credentials (`connections`) are global too, but that one is correct and
stays — you have one X account, not one per agent.

## Decisions

- **Full isolation.** Each agent owns its own missions, campaigns, customers,
  tasks, runs, and automations. Two agents do not share a workspace.
- **Turn-taking is `@mention` with a round-robin fallback.** An agent addresses
  another by name and that agent replies; otherwise agents take turns in order.
  A human can interject on any turn. No moderator agent — it would cost an extra
  model call per turn and become a single point of failure.
- **Memory is private with a shared pool.** Each agent has its own memories;
  `agent_id IS NULL` means a shared business fact every agent reads.
- **The daily platform action cap stays global.** Per-agent caps would multiply:
  three agents at 25 actions each is 75 posts a day, which is a surprise nobody
  wants from a spend guard. `platform_actions` records `agent_id` for
  attribution only.

## Schema

### The one destructive migration

`memories.normalized_content` is declared `TEXT NOT NULL UNIQUE` inline
(`schema.sql:271`). SQLite implements an inline `UNIQUE` as an implicit index
that **cannot be dropped**, so moving to `UNIQUE(agent_id, normalized_content)`
is not an `ALTER` — it is create-new, copy, drop, rename.

This is the only step in v2 that can lose data, and it touches real memories.
It runs behind `db/backup.ts` with a restore verified *before* the rebuild, not
after. It is deliberately sequenced last (increment 3), so it lands when
everything around it is already stable.

### Everything else is additive

`db.ts:27-40` already runs idempotent `ALTER TABLE ADD COLUMN` migrations
guarded by `hasColumn`. Adding `agent_id` follows that existing pattern.

**Only root tables need `agent_id`.** Children are reached through existing
foreign keys and need nothing:

Roots: `sessions`, `scheduled_tasks`, `tasks`, `missions`, `campaigns`,
`paid_growth_campaigns`, `customers`, `evolution_proposals`, `notifications`,
`memories`.

Inherit via parent: `deliverables`, `mission_updates`, `content_items`,
`campaign_generation_runs`, `content_publication_runs`, `paid_growth_decisions`,
`customer_conversations`, `customer_messages`, `customer_reply_drafts`.

That asymmetry is what makes full isolation tractable — ten columns, not thirty.

### New tables

- `agents` — `name`, `role`, `system_prompt` (replaces `business_context`),
  `cwd` (replaces `chat_working_directory`), `avatar`, `color`,
  `permission_mode`, `allowed_tools`, `chat_session_id` (replaces
  `primary_session_id`), `allowed_connections`.
- `agent_conversations` — the room: title, status, turn cap, budget, created_at.
- `agent_conversation_participants` — agent plus the session carrying its side.
- `agent_conversation_messages` — the authoritative speaker-attributed ledger.

## Migration is a rename, not a data move

Create agent #1 named "Jarvis". Backfill `agent_id` on every existing row to it.
Move `business_context` into its `system_prompt` and `chat_working_directory`
into its `cwd`. The current system becomes agent one, with no data loss and no
behaviour change until a second agent exists.

## Agent conversations

A room message goes to the next speaker as a user-role message tagged with who
said it. That agent's `result` text becomes the next room message. `@name` in a
reply routes the next turn; absent that, round-robin.

**A room costs one concurrency slot, not N.** Agents in a room speak
sequentially, so exactly one session is ever mid-turn. `maxConcurrentSessions`
(default 3, `repo.ts:698`) needs no change — which it would have, had rooms run
their agents in parallel.

### Three hard stops, designed in from the first commit

Two agents talking is an infinite generator, and it runs unattended:

1. A **turn cap** per room.
2. A **wall-clock budget** per room.
3. A **stop button** that interrupts the current speaker and closes the room.

This is the single most likely way v2 burns a night of quota. None of these is a
later hardening pass.

The existing `canUseTool` gate still fires per agent, so one agent asking
another to post to X still reaches a human. The approval prompt must name
*which* agent asked — with several agents live, "a session wants to post" is not
an answerable question.

## Sequencing

Each increment ships on its own and leaves the app working.

1. **`agents` table, migration, agent picker page.** Jarvis becomes agent #1.
   Nothing else changes visibly. The risky migration lands alone so it can be
   verified and rolled back by itself.
2. **Agent-scoped dashboard.** Thread `agent_id` through the API, the store, and
   the pages; add the agent switcher to `AppShell`.
3. **Memory split.** The `memories` rebuild, private plus shared pool.
4. **Conversations.** Rooms, the turn engine, the caps, the merged transcript.

## Consequences elsewhere

- **The unauthenticated orchestrator API gets materially worse.** Several agents
  holding separate credential grants behind an API with no authentication is a
  different risk from one agent doing so. Raised from low to high in `GAPS.md`.
- **The SDK's built-in `agents` option does not fit.** It defines subagents that
  share one parent context; v2 needs separate personas with separate memory and
  separate credential grants. Distinct sessions per agent is the right call.
- `DESIGN_SYSTEM.md` needs an agent-identity section: colour and avatar per
  agent, and how a room transcript attributes speakers without turning into a
  wall of badges. The one accent colour rule and per-agent colour will collide —
  resolve it there before building increment 4.
