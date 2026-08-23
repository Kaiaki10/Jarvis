# Jarvis design system

This is the contract. `apps/web/src/app/globals.css` is where the tokens live;
this file explains what they mean and when to reach for each one.

Read this before changing anything visual. If a change would contradict a rule
here, the rule is what's wrong — update this file in the same commit, and say
why. A change that silently violates it is a regression even if it looks nice in
isolation.

## Two experience modes

The root experience has two intentionally different densities over the same live data:

- **Simple** is the default front door. It removes navigation chrome, centers the active
  agent as an animated presence, and gives conversation and voice input visual priority.
- **Under the hood** is the full operating system: the existing sidebar, command center,
  operational metrics, approvals, missions, and configuration surfaces.

This is a presentation boundary, not a data boundary. Both modes use the selected agent,
the same continuous chat session, durable memory, permission gates, and shared event stream.
Never create a demo-only assistant or a second conversation ledger for Simple mode. The
mode choice is local and persistent; changing it must not start, stop, or mutate agent work.

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

## The motion layer

Everything animated lives in `apps/web/src/components/motion/`. One place to
judge whether the app moves coherently, and one place to fix it when it doesn't.
Components compose these rather than hand-rolling transitions.

There are two engines behind it, split by what each can actually do.

**CSS — the default.** Runs on the server, costs nothing at runtime. Reach for
these first; most motion in the app should stay here.

| Primitive | What it does | Where it belongs |
|---|---|---|
| `Stagger` | Sections settle in sequence on load | Above-the-fold sections |
| `Reveal` | Reveals on scroll approach, once | Below-the-fold sections |
| `Spotlight` | Pointer-tracked highlight on a surface | Cards worth pointing at |
| `CountUp` | Animates a number to its new value | Any figure that changes |

**Motion (`motion` v13) — for what CSS structurally cannot reach.** React
unmounts an element before any CSS transition can run on it, so *leaving* is
impossible in CSS; so is morphing between two layout positions. That is the
whole justification for the dependency, and the bar for adding to this half.

| Primitive | What it does | Where it belongs |
|---|---|---|
| `AnimatedList` / `AnimatedItem` | Rows animate in, out, and into each other's place | Any list that changes while on screen |
| `AnimatedBody` / `AnimatedRow` | The same for `<table>` rows | Ledgers and tables |
| `Crossfade` | Dissolves one view into another | Loading → content; a badge changing state |
| `Overlay` | A dialog's backdrop and panel, with the exit | Modals |
| `Meter` | A bar that springs to a new fraction | Progress and usage |
| `Pressable` | Lifts on hover, gives under the press | Controls worth touching |
| `SharedElement` | Carries one element across a navigation | A row and the page it opens |
| `SectionRail` | Where you are in a long page, and a way to jump | Documents past a screen or two |

A dialog has to stay mounted while it closes, or React removes it before the
exit can run — so pass `Overlay` an `open` prop rather than rendering it behind
a `&&`. That costs something conditional rendering gave for free: a form that
never unmounts keeps its state, so a cancelled draft would reappear next time.
`useDialog` (`@/lib/useDialog`) is the answer — an open flag plus a key that
changes on each open and holds steady through the close. Where the dialog is
opened *with* a record, keep that record in state past the close too; clearing
it is what would make the panel vanish rather than leave.

`MotionProvider` must stay mounted at the app root: it carries
`reducedMotion="user"`, which is what keeps the Motion half honouring the OS
setting the way the global CSS rule does for the CSS half. Without it, adding
Motion would silently opt the app out of an accessibility guarantee it keeps.

Springs come in the same two weights on both sides. The CSS ones
(`--spring-gentle`, `--spring-snappy`) are curve approximations rather than a
physics solver, so they compose with plain transitions and cost nothing; the
Motion ones (`spring.gentle`, `spring.snappy`) are the real solver, tuned to
match. Pick by authority either way: a whole panel settles gently, a small
control can be snappier.

One consequence worth knowing before it surprises you in a test: an element
being removed now stays in the DOM until its exit finishes. Assert with
`waitForElementToBeRemoved`, not an immediate `not.toBeInTheDocument()`.

Materials (`.material-glass`, `.material-spotlight`) are for surfaces that float
above the page. Reserve glass for things that genuinely float — the sidebar,
overlays, anything sticky — so "floating" keeps meaning something.

### What this is not

This is a dashboard, not a product launch page. Apple's site is a linear story
you scroll once, where scroll *is* the interaction; this is a control room
someone opens twenty times a day. So:

- **Never hijack scroll.** No scroll-jacking, no pinned sequences that trap the
  page, no waiting through an animation to reach a number.
- **Nothing important is gated behind a scroll.** A reveal may only ever delay
  something below the fold. (`Reveal` fires once and stays revealed for the same
  reason — content that re-animates every time it crosses the fold reads as
  broken, not polished.)
- **Animation is never load-bearing.** If it doesn't run, the interface still
  works and still tells the truth.

### The ladder

Each rung is one session's work and builds on the one below. Climb; don't
restyle sideways. A rung counts as done when it is applied in at least three
real places, documented in the table above, and verified by screenshot.

> **The screenshot half of that rule is currently unenforceable.** Every page is
> behind the passkey gate, and `scripts/screenshot-dashboard.mjs` launches a
> browser with no session, so it can only ever reach `/login`. It used to
> photograph the login card once per page and report success; it now fails
> loudly instead. Until it can hold a session — a Playwright virtual
> authenticator with a registration path, or a persistent context carrying a
> real login — rung completions are verified by tests and review, and should say
> so rather than implying an image exists.

- [x] **0 — Foundation.** Tokens, type scale, elevation, focus ring.
- [x] **1 — Motion layer.** Springs, materials, `Stagger`/`Reveal`/`Spotlight`/`CountUp`.
- [x] **2 — State transitions.** Things morph instead of swapping. Loading
      states crossfade into content, status badges dissolve between states, and
      list rows animate on add and remove. Applied in Budgets, the workflow
      stage rail, Accounts, Posts, Cards, the wallet and the ledger. All seven
      dialogs enter and leave.
- [x] **3 — Shared elements across navigation.** Opening a run from the list
      carries its title and status across rather than cutting to a new page,
      via `SharedElement`. Three conditions have to hold, and it degrades to a
      plain navigation whenever they don't:
      - **The destination must render the element in the same commit as the
        navigation.** If it waits on a fetch, no pair forms and the element just
        appears. `SessionDetail` reads the run from the store, which is what
        makes the pair possible — a refetch here would silently kill the morph
        while everything still looked fine.
      - **Both sides must render the same content.** They animate into each
        other, so a wording difference is a visible change mid-flight. The run
        status maps live in `@/lib/sessionStatus` for exactly this reason.
      - **`name` must be unique on screen.** Ids, never labels.

      React's `<ViewTransition>` is in the canary React that Next bundles for
      the App Router, but not in the stable `react` or `@types/react` we compile
      against. `SharedElement` reads it off the namespace so the cast lives in
      one place, and renders children untouched if it is ever absent.
- [x] **4 — Long-page structure.** Settings and Connections carry a
      `SectionRail` and sticky section headers, so where you are is always
      visible. Scroll-*linked*, never scroll-hijacked: the rail reports position
      and answers clicks, and never takes the scroll away from you.
      - Driven by IntersectionObserver, not a scroll handler — it wakes on
        boundary crossings rather than every frame of every scroll.
      - Both pages export their section list from the component that renders the
        sections (`SETTINGS_SECTIONS`, `CONNECTION_SECTIONS`). A hand-kept second
        copy would drift into a rail entry that scrolls nowhere, and fail
        silently.
      - `CardHeader`'s `sticky` is opt-in. On a card shorter than the viewport
        nothing ever scrolls past it, so it just looks like a rendering bug.
      - Sticky offsets clear AppShell's mobile bar below `lg` — it is a real
        sticky sibling, not an overlay.
- [x] **5 — Physicality.** Task cards drag between columns and settle with
      overshoot rather than stopping dead. The rules that made it safe:
      - **Drag is an addition, never the only way through.** The move buttons
        stay, and were fixed on the way — revealed on hover alone, they were
        unreachable by keyboard and invisible on touch.
      - **It does not arm on a coarse pointer.** A 2D drag needs
        `touch-action: none`, which would take vertical scrolling away from
        anyone whose thumb lands on a card. `(pointer: fine)` only, defaulting
        off so server and first client render agree.
      - **The card lands where you put it.** A drop that waits on the round trip
        springs back, pauses, then jumps — the redraw feeling the whole ladder
        exists to remove. The move is optimistic, and reverts visibly if the
        write fails.
      - **Drop targets light up for the whole drag, not per pointer position.**
        Tracking the pointer would mean state on every frame.
- [ ] **6 — Ambient state.** The interface quietly reflects what the system is
      doing — a background that shifts while a run is active, so you can tell at
      a glance without reading a badge. Subtle enough to ignore.

### Budget

Craft that costs responsiveness isn't craft. These are limits, not targets:

- Animate `transform` and `opacity` only. Anything triggering layout drops frames
  on a page this dense.
- No animation on a repeating list row's mount beyond opacity — a fifty-row list
  must not stagger fifty times.
- `will-change` only while a transition can still run, never parked permanently.
- A new Motion primitive must be something CSS cannot express. If a plain
  transition would do, it belongs in the CSS half — the dependency is paid for
  by exits and layout morphing, not by convenience.
- Pointer-driven effects write CSS custom properties; they never call `setState`
  on move, and they batch reads into one `requestAnimationFrame`.
- Every rung must hold "no console errors" in the screenshot run at both widths.

## Spacing and layout

- Page padding `px-8`; sections `gap-6`; inside a card `px-5`, header `pt-5 pb-4`.
- Radius: `rounded-card` for panels, `rounded-lg` for controls, `rounded-full`
  for badges and dots.
- Reading measure caps at `max-w-2xl`. Long prose in a wide container is hard to
  read no matter how nice the type is.
- A grid row with cards of unequal height needs `items-stretch` and `h-full` on
  the children, or the short column leaves a void.

## Conversation and memory

Jarvis is a relationship surface, not a request form. The interface must make
continuity and current activity legible without pretending the system is more
available or more certain than it is.

- New assistant text appears as it streams. While the user remains near the end
  of the transcript, the view follows it; scrolling upward suspends auto-follow
  so reading is never interrupted.
- Presence is truthful. A live pulse requires an open orchestrator event stream;
  reconnecting and offline states use their real status and never say “live.”
- Durable memory changes appear without a reload. The conversation shows how
  many active memories exist and links to a place where each can be reviewed or
  archived.
- Memory is explicit and bounded: Jarvis saves durable facts, preferences,
  decisions, and relationship context—not secrets, guesses, or transient chat.
- A visual pass on the conversation must inspect an active streamed reply as
  well as the idle screenshot. Static empty-state polish alone is insufficient.
- Motion may make arrival and presence legible, but token streaming and
  auto-follow use direct DOM updates; never put one React state update per token
  on the render path.

## Customer operations

- The queue, conversation, and customer context remain visually distinct: selection
  happens in the queue, the relationship happens in the transcript, and operational
  controls stay in context and next-action panels.
- Jarvis output is always labeled and reviewable before it enters the outbound timeline.
  Running, ready, used, and failed draft states must be truthful and visible.
- Desktop uses queue + conversation columns before adding a third context column; narrow
  widths stack rather than squeezing a transcript below a useful reading measure.
- The design screenshot pass includes `/customers` at desktop and narrow widths.

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
