/**
 * The motion layer.
 *
 * Every animated behaviour in the app comes from here, so there is one place to
 * judge whether the app moves coherently — and one place to fix it when it
 * doesn't. Components compose these rather than hand-rolling transitions.
 *
 * Two engines, split by what each is actually good at:
 *
 * - **CSS** (`Stagger`, `Reveal`, `Spotlight`, `CountUp`) for anything a
 *   declarative transition can express. Runs on the server, costs nothing, and
 *   is still the default — reach for these first.
 * - **Motion** (`AnimatedList`, `Crossfade`, `Pressable`) for the cases CSS
 *   structurally cannot reach: an element animating *out* before React
 *   unmounts it, a layout morphing between two positions, and gestures that
 *   need to interrupt mid-flight. These ship JS, so they earn their place one
 *   at a time.
 *
 * The rules these all follow, and that anything added here must follow:
 *
 * - Animate transform and opacity only. Anything that triggers layout drops
 *   frames on a page this dense.
 * - Honour prefers-reduced-motion, and never let doing so hide content. The CSS
 *   layer does this via a global media query; the Motion layer via
 *   `MotionProvider`, which must stay mounted at the root for that to hold.
 * - Degrade to a plain state change. No animation may be load-bearing —
 *   if it doesn't run, the interface still works and still tells the truth.
 * - Never block input. Nothing here delays what a click does.
 *
 * DESIGN_SYSTEM.md holds the capability ladder: what exists now and what the
 * next rung is.
 */
export { Reveal } from "./Reveal";
export { Spotlight } from "./Spotlight";
export { CountUp } from "./CountUp";
export { Stagger } from "./Stagger";
export { MotionProvider, spring } from "./MotionProvider";
export { AnimatedList, AnimatedItem, AnimatedRow, AnimatedBody } from "./AnimatedList";
export { Crossfade } from "./Crossfade";
export { Meter } from "./Meter";
export { Overlay } from "./Overlay";
export { SharedElement } from "./SharedElement";
export { SectionRail, type RailSection } from "./SectionRail";
export { Pressable } from "./Pressable";
