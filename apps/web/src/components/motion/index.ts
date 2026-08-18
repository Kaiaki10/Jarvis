/**
 * The motion layer.
 *
 * Every animated behaviour in the app comes from here, so there is one place to
 * judge whether the app moves coherently — and one place to fix it when it
 * doesn't. Components compose these rather than hand-rolling transitions.
 *
 * The rules these all follow, and that anything added here must follow:
 *
 * - Animate transform and opacity only. Anything that triggers layout drops
 *   frames on a page this dense.
 * - Honour prefers-reduced-motion, and never let doing so hide content.
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
