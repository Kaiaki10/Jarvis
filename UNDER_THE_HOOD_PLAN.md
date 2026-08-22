# Under the Hood — the machinery Jarvis runs on

Jarvis today is a dashboard you drive. This plan makes him a system that *acts* —
with his own connections, his own money, his own automations, and a place to see
all of it. The face and the machinery become two layers instead of one flat list
of nineteen pages.

Written 2026-08-21, from the dashboard conversation of the same day. This is the
plan of record; when reality diverges, change this file in the same commit and
say why.

**Status: increments 1 and 2a shipped 2026-08-21.** The two-layer split, the
module registry, category-grouped Connections, and Social → Posts/Platforms are
live. Analytics and increments 3–5 are open.

**Resolved 2026-08-21 — see `BUSINESS_CONTEXT.md`.** The root cause was not a
broken pipeline: Jarvis had no business context at all (`business_context` was
absent from settings, and the Jarvis agent had no system prompt), so nothing had
ever been given anything to work with. Context is now written and applied, and a
first campaign has produced five drafts that render in Social → Posts. The
generation pipeline itself worked first time.

**Original finding, kept for the record:** the business tables are empty — 0
campaigns, 0 content items, 0 missions, 0 wallet spends, 0 cards, 1 platform
action, against X/Slack/Resend all connected. Every module in this plan renders
something Jarvis has not produced yet. Posts and Platforms are correct and show
their empty states; Analytics, Crypto, and Money would be infrastructure with no
data behind it. Getting Jarvis actually producing content is a prerequisite for
the rest of this plan paying off, not a parallel track.

## The two layers

| **Jarvis** — what you work on together | **Under the Hood** — how he's wired up |
|---|---|
| Chat | Social — what he published and how it did |
| Missions & goals | Crypto — his wallet, holdings, launches |
| Tasks | Money — cards, budgets, the ledger |
| Campaigns & content | Automations — schedules, triggers, policies |
| Customers | Connections — every integration, one registry |
| Notifications | Brain — memory, agents, evolution |

The split is the point. Everything on the left is a thing you and Jarvis produce
together. Everything on the right is a permission, a credential, a limit, or a
record of what he did with them. Today those are interleaved, so "what is Jarvis
allowed to do" has no single answer and no single screen.

## Decisions

- **Modules, not pages.** Each module owns its routes, components, tables, and
  endpoints. Adding a feature is adding a folder. This is the whole reason the
  structure exists — Social and Crypto are both expected to grow for months.
- **Crypto and Money stay separate.** Different providers, different failure
  modes, different controls. Merging them would produce one module with eleven
  sub-pages inside a quarter.
- **Budget envelopes, not per-transaction approval.** You set a cap per rail;
  under it Jarvis spends and logs, at it he stops and asks. Per-transaction
  approval means he cannot run an unattended workflow that costs anything, which
  defeats the purpose of giving him a wallet.
- **One definition file per connection drives every surface.** Connections,
  Permissions, and Money all render from the same registry. Adding an integration
  is one file, not one file plus three UI edits that drift.
- **The outbound approval gate survives all of this.** Budget envelopes bound
  *spend*. They do not bound *publishing*. Posting, messaging, and emailing keep
  going through `canUseTool` exactly as they do now.

## Module anatomy

Every module follows the same shape, so the fifth one costs less than the first:

```
apps/web/src/app/under-the-hood/<module>/
├── layout.tsx           # module sub-nav
└── <feature>/page.tsx   # one folder per feature
```

```
apps/orchestrator/src/<module>/   # service logic
packages/shared/src/<module>.ts   # types both sides import
```

Tables are namespaced by module (`social_*`, `crypto_*`) so they grow
independently. Features ship behind flags, which is what lets Crypto → Launch
exist in code long before it's reachable in the UI.

### Modules at first delivery

| Module | Features | Notes |
|---|---|---|
| **Social** | Posts, Analytics, Platforms | Posts renders `content_items`; Analytics needs new ingestion (see below) |
| **Crypto** | Wallet, Spending, Investments, Launch | Wallet/Spending build on `wallet_spends`; Investments and Launch are new |
| **Money** | Cards, Budgets, Transactions | Cards build on `stripe_cards`; Budgets and the ledger are new |
| **Automations** | Schedules, Triggers, Policies | Schedules exist; triggers and policies are new |
| **Connections** | Registry grouped by category | Done — groups by the `category` already on every definition |
| **Brain** | Memory, Agents, Runs, Evolution | Done — existing pages relocated; Runs moved here from top level |

## The connection registry

`PlatformDefinition` already carries `id`, `name`, `category`, `fields`, `steps`,
and `capabilities` — twelve platforms across six categories, including Stripe and
Coinbase. The Connections page ignores `category` entirely and renders a flat
list. That is the smallest, highest-leverage fix in this plan.

The definition grows three fields:

```ts
interface PlatformDefinition {
  // ...existing
  /** Money rails this platform can move value over, if any. */
  rails?: Array<{ id: string; kind: "card" | "wallet" | "ad_budget"; label: string }>;
  /** Tools this platform contributes, and whether each is spend-bearing. */
  tools?: Array<{ name: string; spendBearing: boolean }>;
  /** Default envelope for a newly connected platform. Never unlimited. */
  defaultEnvelope?: { dailyLimitUsd: number };
}
```

Connections groups by `category`. Permissions lists every `tools` entry with its
current gate. Money lists every `rails` entry with its envelope. Three pages, one
source of truth, and a new integration lights up all three.

## Money: envelopes replace counting

Today's guard counts **actions**, not dollars: one global
`settings.dailyPlatformActionCap` applied per platform, with `estimatedSpendToday`
documented in the code as "a floor rather than an invoice." That is a reasonable
guard against a runaway loop and a poor guard against overspending — twenty cheap
posts and twenty expensive ad buys are the same number.

Envelopes are per rail and denominated in money:

| Rail | Envelope | Enforced at |
|---|---|---|
| Stripe cards | daily + monthly USD | before authorization |
| Crypto wallet | daily USDC | before signing |
| Ad budgets | daily USD per platform | before the API call |

Checked before the spend, so a blocked spend costs nothing — the same discipline
`checkDailyCap` already uses. Every spend lands in one `spend_ledger` regardless
of rail, which is what makes "what has Jarvis spent this month" a single query
instead of three joins across two providers.

The count cap does not go away. It stays as the runaway-loop guard, because a
bug that posts four hundred times is a real failure mode that no dollar limit
catches.

## Schema

Additive, following the existing `hasColumn`-guarded pattern in `db.ts`. No
destructive migration in this plan — a welcome contrast to v2.

New tables:

- `spend_envelopes` — rail, limit, period, agent_id
- `spend_ledger` — rail, amount, currency, reason, session_id, agent_id, created_at
- `social_metrics` — content_item_id, platform, metric, value, captured_at
- `crypto_holdings` — token, chain, amount, cost_basis, agent_id
- `crypto_launches` — token, chain, status, config, agent_id
- `automation_triggers` — event, condition, action, enabled, agent_id

All carry `agent_id`, per the v2 isolation rule for root tables.

## Sequencing

Each increment ships on its own and leaves the app working. Risk climbs as it
goes, deliberately — the structural work lands and stabilizes before anything
touches money.

1. **The split and the registry.** Two-layer nav, `under-the-hood/` routing,
   module layout primitives, Connections grouped by category, Brain relocated.
   No new capability — this is pure structure, and it's reversible.
   *(Done 2026-08-21.)* Modules live in `apps/web/src/lib/underTheHood.ts`, which
   the sidebar and the module sub-nav both render from, so a module cannot exist
   in one and not the other. Social, Crypto, and Money are registered but
   `enabled: false` until they have content. Brain absorbed Runs alongside
   Memory, Agents, and Evolution. Every former top-level path 308-redirects to
   its new home (`next.config.ts`), children included, so old bookmarks and
   notification deep links still land.
2. **Social.** Posts view over `content_items`. Metric ingestion and Analytics.
   Platforms sub-page from the registry.
   *(Posts + Platforms done 2026-08-21.)* Both render from data already in the
   store, so neither needed a new endpoint. Analytics is deliberately not in the
   module registry yet — a tab that can only ever draw an empty chart is worse
   than no tab. Posts is covered by component tests rather than a live check,
   because there is no content in the database to look at.
3. **Money.** Envelopes, the unified ledger, Cards and Budgets and Transactions.
   Lift the Stripe and wallet panels out of the connection wizard, where they are
   currently buried, into a real financial surface.
4. **Crypto — Wallet, Spending, Investments.** Portfolio and P&L on top of the
   ledger from increment 3.
5. **Crypto — Launch.** Last, alone, and gated. See below.

## What this deliberately does not do

- **No no-code connection builder.** The registry is a code file. A generic
  form-driven connector cannot express signed webhooks or OAuth1, which half the
  existing integrations need. Revisit once the registry has proven out.
- **No new agent capabilities in increment 1.** The nav split must be boring and
  reversible. Shipping structure and power together makes a rollback impossible
  to reason about.
- **No autonomous trading.** Investments tracks holdings and P&L. Buy/sell
  triggers are a separate decision with a separate risk profile, not a sub-page.

## Consequences elsewhere

- **Per-agent API authorization stops being optional.** `GAPS.md` records it as
  open: the token proves the caller is the dashboard, not *which agent* it is
  acting as. That is tolerable when agents share a posting credential. It is not
  tolerable when an agent has a spending envelope, because the API cannot
  currently tell whose envelope is being drawn against. **This should close
  before increment 3**, the same way authentication closed before v2's increment
  2 and for the same reason.
- **Social analytics needs data that does not exist yet.** `performance_summary`
  on `content_items` is a free-text field an agent writes; nothing ingests real
  engagement metrics from platform read APIs. Analytics is a data-plumbing
  project wearing a dashboard costume, and increment 2 should be estimated that
  way.
- **Automatic publishing is still X-only** (`GAPS.md`, open). Social will
  truthfully show one platform's posting pipeline and five platforms' connection
  status until that closes.
- **Crypto → Launch carries real-world exposure the other modules don't.**
  Deploying a token that other people can buy touches securities and fraud law in
  most jurisdictions, and it is the one place where autonomous, irreversible, and
  other-people's-money all intersect. Sequenced last so nothing depends on it,
  and it should ship behind an explicit human confirmation regardless of envelope
  state — an envelope is a spending limit, not informed consent. Worth a lawyer's
  read before it leaves the flag.

## What the first real campaign taught us (2026-08-21)

The generation pipeline worked on the first attempt — campaign → isolated session →
structured drafts → `content_items`, reconciled without intervention. What did not work
was the *truthfulness* of the output, and that is the finding worth keeping.

Given the fact "both processes bind to `127.0.0.1`", the first draft escalated it to
"not a config flag, not an env var you can flip… unreachable by construction". That is
false — `server.ts:273` reads `process.env.HOST ?? "127.0.0.1"`, and the README documents
overriding it. The model had hardened a **default** into a **guarantee**, and it did so
about a security property, which is the one category the context explicitly fenced off.

Two things follow:

- **A Facts list must carry its own caveats.** Stating a true fact is not enough; if the
  fact has a limit, the limit has to be in the fact. Absent that, plausible-sounding
  escalation fills the gap. The context now says "a default is a default — if a fact does
  not say *cannot*, do not write *cannot*", and names this exact miss as the example.
- **The approval gate earned its place.** A confident, well-written, factually wrong
  claim about network exposure is precisely what an unattended pipeline would have
  published at 6am. Nothing about the draft looked wrong; it read better than the
  correction. Review is not friction here, it is the control.

Regenerating the same post against the corrected context produced an accurate version
that draws the default-versus-guarantee distinction explicitly — better content than the
false one, because the distinction is the insight.

## Multi-account connections (2026-08-21)

`V2_PLAN.md` deliberately left credentials global: *"Platform credentials
(`connections`) are global too, but that one is correct and stays — you have one X
account, not one per agent."* That assumption is now wrong. Jarvis is to run several
businesses at once, and each needs its own accounts.

**Decision: agents own connections, with a shared pool.** `connections` grows an
`agent_id`; `NULL` means every agent may use it. This is the same private-plus-shared
shape `memories` already uses, and it makes isolation structural rather than
conventional — a session for one agent is only ever handed that agent's tools, so it
*cannot* post as another business. Free choice was never on the table: the failure mode
is one business's content appearing publicly on another's timeline.

**Caps become per account.** `checkDailyCap` keys on the connection rather than the
platform, so two businesses posting normally cannot starve each other and a runaway loop
is contained to the account it happened on.

### The migration

`connections.platform_id` is the PRIMARY KEY, so this is a table rebuild — create, copy,
drop, rename — the same shape as v2's `memories` migration, behind `createDatabaseBackup`.
Existing rows become **shared** (`agent_id IS NULL`), which preserves today's behaviour
exactly: every agent keeps reaching every currently-connected platform.

### Resolution rule, and why it can return nothing

Thirteen call sites ask for credentials by platform alone — Stripe, Coinbase, push,
notification email, the Slack bridge, ad adapters. They keep working, against this rule:

1. the shared connection for that platform, if one exists; else
2. the only connection for that platform, if there is exactly one; else
3. **nothing.**

Case 3 is the point. With two agent-owned X accounts and no shared one, "the X account"
has no answer, and guessing means posting as the wrong business. Returning `undefined`
turns that into a visible failure instead of a public mistake.

### Explicitly not in this increment

- **Inbound webhook routing.** `/webhooks/x`, `/webhooks/facebook` and friends resolve by
  platform alone. With several accounts on one platform, an inbound message cannot yet be
  attributed to the right business, so multi-account inbound stays unsupported until each
  provider's payload is matched to a specific account. Outbound is what this increment
  delivers.
- **Slack agent bridge**, which assumes a single workspace.
- **Credential backup format**, still keyed by platform.
