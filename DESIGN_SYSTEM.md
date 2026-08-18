# Jarvis design system

This is the contract. `apps/web/src/app/globals.css` is where the tokens live;
this file explains what they mean and when to reach for each one.

Read this before changing anything visual. If a change would contradict a rule
here, the rule is what's wrong — update this file in the same commit, and say
why. A change that silently violates it is a regression even if it looks nice in
isolation.

## The idea

A dark, quiet control room. Dense with information, calm to sit in front of.
Depth comes from light and elevation, never from ornament. If an effect doesn't
help someone find or trust something on the page, it doesn't belong.

Three principles, in priority order when they conflict:

1. **Legibility beats decoration.** Contrast, spacing and hierarchy first.
2. **Motion explains, it doesn't perform.** Animation shows what changed or what
   is live. Nothing loops for its own sake.
3. **Restraint.** One accent colour. Three text levels. Three elevations. When
   something needs to stand out, take emphasis *away* from its neighbours rather
   than adding more to it.

## Type

Named by role, not size — components say what a thing *is* and the scale decides
how big that is. Never write `text-sm`, `text-xs`, or `text-[11px]`; there is a
token for every case.

| Token | Size | Use for |
|---|---|---|
| `text-display` | 28px / 640 | Page title. One per page. |
| `text-title` | 17px / 600 | Card titles that lead a major panel; the empty-state headline. |
| `text-heading` | 13px / 600 | `CardHeader` titles, section labels. |
| `text-body` | 14px | Sentences, messages, form values, list rows. |
| `text-label` | 12px | Secondary lines, metadata, helper text. |
| `text-micro` | 11px | Timestamps, badges, uppercase eyebrows. |

Numbers that update in place (clocks, counts, durations) get `tabular-nums` so
they stop jittering. Timestamps and IDs get `font-mono`.

## Colour

| Token | Meaning |
|---|---|
| `background` | The page. Never used on a panel. |
| `surface` / `surface-raised` / `surface-overlay` | The elevation ladder. |
| `foreground` | Primary text — the thing you're meant to read. |
| `foreground-secondary` | Supporting text still meant to be read. |
| `muted` | Labels and metadata. Not for anything load-bearing. |
| `accent` / `accent-bright` | Jarvis itself: your messages, the current page, primary actions. |
| `success` / `warning` / `danger` | State only. Never decoration. |

Accent means "Jarvis, or you". Don't spend it on ordinary panels — it stops
meaning anything if it's everywhere.

Status colour is reserved for status. A red border must mean something is wrong.

## Elevation

`<Card elevation>` — 0 recedes, 1 is the default panel, 2 is the thing you came
to the page for. At most one level-2 card per screen. Elevation is a light wash
plus a shadow: on a near-black background, shadow alone is invisible.

## Motion

Two durations (`--duration-fast` 140ms, `--duration-base` 240ms) and two curves
(`--ease-out`, `--ease-spring`). Everything visual honours
`prefers-reduced-motion` — the global rule in `globals.css` handles this, so
don't fight it with inline styles.

| Class | When |
|---|---|
| `animate-rise-in` | A section arriving on page load. Use `<Stagger index>`. |
| `animate-message-in` | A new message in the conversation. |
| `animate-pulse-soft` | Something is live. |
| `ping-ring` | A live status dot. |
| `text-shimmer` | Work in progress, on the activity line. |

Hover transitions belong on interactive things only. A card that isn't a link
shouldn't move when the pointer crosses it.

## Spacing and layout

- Page padding `px-8`; sections `gap-6`; inside a card `px-5`, header `pt-5 pb-4`.
- Radius: `rounded-card` for panels, `rounded-lg` for controls, `rounded-full`
  for badges and dots.
- Reading measure caps at `max-w-2xl`. Long prose in a wide container is hard to
  read no matter how nice the type is.
- A grid row with cards of unequal height needs `items-stretch` and `h-full` on
  the children, or the short column leaves a void.

## Non-negotiables

These are the ones that get quietly broken. Check them on any visual change.

- **Focus is visible.** The global `:focus-visible` ring stays. Never
  `outline: none` without an equally visible replacement.
- **Contrast.** Body text on its own surface clears WCAG AA (4.5:1); `muted` is
  for supporting text only and must clear 3:1.
- **Icons that carry meaning need text or `aria-label`.** An icon-only button is
  unlabelled to a screen reader without one.
- **Interactive targets are at least 32px.**
- **Nothing scrolls horizontally.** Long strings get `truncate` or `break-words`
  with `min-w-0` on the flex parent.
- **Empty states say what will fill them**, not just "nothing here".
- **No layout shift on load.** Reserve space rather than collapsing it.

## Working on this

The point is convergence, not novelty. Fewer, better-applied primitives beats
more of them.

- Change a token, not a component, when the fix is global.
- If a component needs a one-off colour or size, that's a signal the system is
  missing something. Add the token.
- Restyling something that already conforms to this document is churn. Find what
  doesn't conform, or improve something that is genuinely hard to use.
- Screenshot before and after. `node scripts/screenshot-dashboard.mjs` captures
  every page at desktop and narrow widths and reports console errors.
- To see *your* build rather than the running one, start it on port 3100 and set
  `JARVIS_WEB_URL=http://localhost:3100` before running that script. The
  orchestrator allows that origin through CORS for exactly this reason
  (`PREVIEW_ORIGIN` in `apps/orchestrator/src/http/server.ts`). Never restart the
  live service to preview a change — port 4317 is the orchestrator that runs the
  automations, including the one doing the previewing.

## Who maintains this

Two automations work against this document, both from the `jarvis-lab` worktree:

- **Critique** (05:30 Mon/Thu) reviews the live dashboard against this file and
  files findings under `## Design` in `AUTOMATION_BACKLOG.md`. It does not
  implement.
- **Polish** (06:30 daily) takes the most severe open finding, or rotates through
  the app when the queue is empty, and implements exactly one improvement.

They commit to `jarvis/auto`. Nothing they do reaches `master` without a human
merging it.
