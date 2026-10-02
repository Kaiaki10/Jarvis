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

### medium — Attribution covers leads and revenue, but not organic engagement
Lead-source attribution now works end to end (2026-10-02). Every inbound customer gets a
first-touch `acquisition_channel`, inferred in `customers/acquisition.ts` from UTM tags,
then the referrer, then the platform they messaged on. The website widget remembers the
landing page's UTM tags and external referrer, so they survive until chat opens. Stripe
revenue accumulates on the matched customer. The Customers page shows customers and
revenue per channel, with unattributed customers kept visible as "Unknown".

Still missing is structured organic engagement data. `social_metrics` exists but is
unpopulated, blocked on X's metrics API returning HTTP 402 "credits depleted", not on code.
Known limits of what's there: a Stripe payer who never chats has no source (Payment Links
carry no UTM through to the webhook), and "direct" also covers stripped referrers, so read
it as "unknown, probably not a campaign". Tracked links remain a deliberate non-goal per
`WORKFLOW_PLAN.md`.

### medium — Automatic publishing currently supports X only
The publication worker is adapter-based, but LinkedIn, Instagram, Facebook, and blog
connections do not exist yet, and email campaigns need audience/list semantics rather than
a single-recipient send tool. Those channels can still use the content calendar and manual
published state, but only X has confirmed automatic dispatch today. Update 2026-10-01:
content items can now carry an attached visual (`image_file`, set from brand visuals or
the editor) through the approval-gated X path, and autopilot deliberately skips visual
items rather than publishing them text-only — but the per-channel gap above is unchanged.

### low — Credentials are entered by hand
Every platform requires manually copying tokens. Proper OAuth flows would be friendlier
but need a public redirect URL.

## Closed

Closed gaps were trimmed in Jarvis 2.0 to keep this register readable; their
history is in git (`git log -p -- GAPS.md`).

## Notes for the daily review

- Do not restate a gap that is already Open. Sharpen the existing entry instead.
- Evidence beats speculation: cite the file, the behaviour, or the transcript.
- Reporting "nothing new" is a valid and useful outcome.
