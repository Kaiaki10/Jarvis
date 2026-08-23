"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Spring definitions shared by everything Motion-driven, so the app moves with
 * one voice rather than per-component guesses.
 *
 * These mirror `--spring-gentle` and `--spring-snappy` in `globals.css`. The CSS
 * versions are curve approximations and stay in use for simple transitions;
 * these are the real solver, for the cases CSS cannot express — an element
 * animating out, or a layout morphing between two positions.
 *
 * Pick by authority, same rule as the CSS ones: a whole panel settles gently, a
 * small control can be snappier.
 */
export const spring = {
  gentle: { type: "spring", stiffness: 200, damping: 30, mass: 0.9 },
  snappy: { type: "spring", stiffness: 420, damping: 32, mass: 0.7 },
} as const;

/**
 * Wraps the app so every Motion animation honours the reader's own setting.
 *
 * `reducedMotion="user"` reads the OS preference and reduces to opacity-only
 * changes — matching what the global CSS rule already does for the CSS layer.
 * Without it, adding Motion would quietly opt the whole app out of an
 * accessibility guarantee it currently keeps.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={spring.gentle}>
      {children}
    </MotionConfig>
  );
}
