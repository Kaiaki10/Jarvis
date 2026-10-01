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
comparing paid campaigns against each other, but Campaign Studio still has
no structured organic engagement data — `social_metrics` exists but is unpopulated, blocked
on X's metrics API returning HTTP 402 "credits depleted" rather than a code gap — and no
customer or lead ever carries an acquisition channel or revenue figure; `customers` has no
such column and no inbound path (webhook or website widget) captures a referrer or UTM.
Until at least one of those exists, "shift the full marketing allocation toward what's
winning" has no organic or lead-revenue evidence to act on — only the paid-vs-paid
comparison is real today. Tracked links remain a deliberate non-goal per
`WORKFLOW_PLAN.md`; whether that still holds is worth reconfirming against the live
`BUSINESS_CONTEXT.md` before anyone builds click tracking to close this the rest of the way.

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
