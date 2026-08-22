# Workflows — the spine

Jarvis has modules that each do something and nothing that ties them together.
Accounts live in Connections, content in Social, ad spend in Paid growth, and
nothing carries a result back to the decision that produced it. A **workflow** is
that missing thing: one durable operation for one business, from the accounts it
posts as to what it learned about what works.

Written 2026-08-21. Plan of record; when reality diverges, change this file in
the same commit and say why.

## The five stages

Onboarding walks these in order, and each is a real surface afterwards.

| # | Stage | What it means | State |
|---|---|---|---|
| 1 | Accounts | Which accounts this workflow may post as | Connections exist; the link is new |
| 2 | Content | Generate and store drafts through to published | Exists as campaigns, being renamed |
| 3 | Metrics | Per-post engagement, ingested from the platform | New — nothing ingests today |
| 4 | Advertising | Ad spend and marketing analysis against this workflow | Paid growth exists, unlinked |
| 5 | Learning | What consistently performs, fed back into generation | New |

## Decisions

- **Workflow replaces campaign.** `campaigns` already carried objective,
  audience, offer, channels and a primary metric — all workflow-level concerns.
  Keeping both would put those fields in two places and make you choose between
  them every time you write a post. A second content push is a second workflow.
- **A workflow owns its accounts, and content can reach no other.** Accounts
  attach through `workflow_accounts`, and a publication session is handed only
  those. Isolation is structural: a tool that was never built cannot be called.
  This is the guarantee that one workflow's content never lands on another's
  account.
- **Stage 5 learns from engagement, and says so.** Revenue attribution needs a
  signal the system does not have — tracked links are forbidden by the current
  business context, and time-window attribution against Stripe is a guess that
  misleads at low volume. So the surface is labelled **"what gets engagement"**,
  never "what makes money", until a real revenue signal exists. Naming it
  honestly is the difference between a useful tool and a confident lie.
- **Onboarding is resumable, and permanent.** A half-configured workflow is a
  normal state, not something to finish in one sitting. Stages 3–5 have nothing
  to show until content exists, and pushing someone through them on day one
  would be theatre. This is why the stages became a permanent rail rather than a
  wizard — see the section below.

## Schema

`campaigns` → `workflows`, a table rename plus new columns. SQLite supports
`ALTER TABLE … RENAME TO`, so this is not a rebuild — but `content_items`
references it, and the FK follows the rename automatically under
`legacy_alter_table = OFF` (the default), which is why the rename is done inside
one transaction with foreign keys suspended.

New:

- `workflow_accounts` — `workflow_id`, `connection_id`. Replaces the single
  `campaigns.connection_id` pin added earlier today; a workflow legitimately has
  several accounts (an X account and an email sender), and one column cannot say
  that.
- `social_metrics` — `content_item_id`, `platform_id`, `metric`, `value`,
  `captured_at`. One row per observation, not per post, so a metric history is
  queryable rather than overwritten.
- `workflow_insights` — `workflow_id`, `statement`, `evidence`, `confidence`,
  `created_at`. Stage 5 output, in words, with what it was derived from.

Changed:

- `content_items.campaign_id` → `workflow_id`.
- `paid_growth_campaigns.workflow_id` — stage 4's link.

## What this deliberately does not do

- **No revenue attribution.** See the stage 5 decision. The schema does not carry
  a revenue column, because a column invites someone to fill it with a guess.
- **No inbound routing per account.** Unchanged from the multi-account work:
  webhooks still resolve by platform, so multi-account inbound stays unsupported.
- **No automatic acting on insights.** Stage 5 writes down what it observed. A
  human decides whether generation changes. An autonomous loop that rewrites its
  own prompt from its own engagement numbers is how a system talks itself into a
  corner.

## Sequencing

1. **Rename and link.** `workflows`, `workflow_accounts`, content repointed.
   Nothing new visible; existing content keeps working. *(This increment.)*
2. **Onboarding.** The five-stage rail, under Under the Hood. Superseded in
   detail below — it is not a wizard; see "Onboarding is not a wizard".
3. **Metrics.** Ingestion from X, then the Metrics surface.
4. **Advertising.** Link paid growth to a workflow, spend against it.
5. **Learning.** Engagement-derived insights, labelled as such.

---

# The stage rail

Written 2026-08-21, after increment 1 shipped. This section plans stages 1–5 as
a surface; the entity and schema they sit on already exist.

## Onboarding is not a wizard

The five stages **are** the workflow page, permanently. There is no separate
onboarding flow that you complete once and throw away, and no second dashboard
that replaces it afterwards.

This falls out of an awkward truth: stages 3–5 *cannot* be completed on the day
a workflow is created. There are no metrics before a post is published, and
nothing to learn before there are metrics. A linear wizard would march someone
through steps that are impossible yet, and would have to lie or skip. A rail
that shows **blocked, and why** is honest, and it is still the right view a month
later when the same five rows show live status instead of setup state.

```
Building Jarvis in public                    draft

  1  Accounts      ✓   X @nwhussle
  2  Content       ✓   5 drafts, 0 published
  3  Metrics       —   needs a published post
  4  Advertising   —   no ad account connected
  5  Learning      —   needs measured posts
```

`onboarding_stage` therefore stops meaning "which step are you on" and becomes
"how far this workflow has ever got" — useful for sorting and for nudging, never
for gating navigation.

## Stage states

Each stage computes its own state from data, not from a stored flag. A stored
flag drifts the moment someone deletes an account or a post.

| State | Meaning |
|---|---|
| `done` | The stage has what it needs |
| `ready` | Actionable now, not yet done |
| `blocked` | Cannot proceed, with the specific reason |

## What each stage is

### 1 · Accounts
Attach connections from `workflow_accounts`. `done` once at least one is
attached and connected. This is the stage that makes publishing possible at all
— `accountForContent` already refuses to publish a workflow with no attached
account for the channel, so an empty stage 1 is a real block rather than a
cosmetic one.

### 2 · Content
Already built: generate, edit, advance through the pipeline, publish. `done`
once the workflow holds any content. Deliberately **not** gated on stage 1 —
drafting needs no account, only publishing does, and that gate already exists.

### 3 · Metrics
**Blocked today by a gap found while planning this:** `post_to_x` receives the
post id back from X and puts it in a sentence for the model. Nothing persists
it. Without the platform's own id, a published post can never be looked up
again, so no post published so far could ever be measured.

Fix in two parts, sequenced so the cheap half lands first:

- **Capture** — `content_publication_runs.external_post_id`, written by the
  publication reconciler from the tool result. Cheap, and until it exists every
  further post is unmeasurable too.
- **Ingest** — read engagement from the platform into `social_metrics`.
  Dependent on the X credentials carrying read scope, which the current
  connection was set up for posting and may not have. That is checked before
  the ingestion work starts, not discovered halfway through.

### 4 · Advertising
`paid_growth_campaigns.workflow_id` already exists from increment 1. This stage
is the link plus a spend-against-this-workflow view. `blocked` while no ad
platform is connected.

### 5 · Learning
Derives statements from `social_metrics` into `workflow_insights`, each with the
evidence it came from.

- **Labelled "what gets engagement", never "what makes money".** There is no
  revenue signal in this system. The honest label is the whole point of the
  decision recorded above.
- **Manually triggered.** A run costs real usage, and unattended self-analysis
  on thin data produces confident noise. A nudge appears once there is enough
  measured content; a human presses it.
- **Writes down, never acts.** An insight changes generation only when a person
  applies it. A loop that rewrites its own prompt from its own engagement
  numbers is how a system talks itself into a corner.

## Sequencing

1. **The rail.** Stage states computed from existing data, replacing the current
   studio header. Stages 1, 2, 4 become real; 3 and 5 render blocked honestly.
   Attach/detach accounts (stage 1) ships here. *(Done 2026-08-21.)*
   `workflowStages()` lives in `packages/shared` as a pure function over data —
   there is no stored per-stage flag, so detaching an account immediately
   un-completes stage 1 rather than leaving a stale tick. Thirteen tests cover
   it, including that a *failed* publication run does not make a post
   measurable. Stage 4 reports zero linked ad campaigns rather than inferring
   from unrelated paid-growth rows: the `workflow_id` column exists but nothing
   writes it yet, and inferring would overstate the link. *(Done 2026-08-21.)*
   `workflowStages()` lives in `packages/shared` as a pure function over data —
   there is no stored per-stage flag, so detaching an account immediately
   un-completes stage 1 rather than leaving a stale tick. Thirteen tests cover
   it, including that a *failed* publication run does not make a post
   measurable. Stage 4 reports zero linked ad campaigns rather than inferring
   from unrelated paid-growth rows: the `workflow_id` column exists but nothing
   writes it yet, and inferring would overstate the link.
2. **Capture post ids.** `external_post_id` on publication runs. Small, and it
   stops the loss. *(Done 2026-08-21.)* Captured at the tool rather than parsed
   back out of prose: `post_to_x` now returns `externalPostId` as data beside
   its text, `recordAction` stores it on the ledger row, and the reconciler
   copies it onto the run only when the platform actually confirmed the post. A
   failed run keeps a null id, because nothing was published to measure.
3. **X read scope check, then ingestion.** *(Checked 2026-08-21 — blocked, and
   not by scope.)* The credentials read fine: `/2/users/me` returns the account.
   The metrics call returns **HTTP 402 "credits depleted"** — the X API plan has
   no credits, so no amount of code makes ingestion work. Stage 3 is blocked on
   X billing, not on Jarvis.

   The check also turned up a real bug it would otherwise have hidden.
   `oauth1Header` signed the whole URL including its query string, which RFC 5849
   §3.4.1.2 forbids — the base string URI excludes the query, and those params
   belong in the normalised parameter string. Every existing call was query-free
   (POSTs to `/2/tweets` and the media endpoints), so it stayed latent. The first
   GET with parameters returned a bare 401, which reads exactly like bad
   credentials or a missing scope. Fixed and covered; the same live call now
   returns 402 instead of 401, which is how we know the signature is accepted.
4. **Metrics surface.** Stage 3 goes live.
5. **Learning.** Stage 5, on top of real measured data.

## What this deliberately does not do

- **No backfill of existing posts.** Nothing has been published yet, so nothing
  is lost — but had it been, those posts would be permanently unmeasurable, and
  inventing ids for them is not an option.
- **No stage gating.** A blocked stage explains itself; it never prevents using
  the rest of the workflow.
- **No automatic insight application.** See stage 5.
