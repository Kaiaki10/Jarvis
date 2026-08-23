"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "./MotionProvider";

/**
 * A list whose rows animate in, out, and into each other's place.
 *
 * This is the one thing the CSS layer cannot do. A row being removed is
 * unmounted by React before any transition can run on it, so it vanishes — and
 * the rows below it jump up to fill the gap. Both reads as the page redrawing.
 * `AnimatePresence` holds the row in the tree until its exit finishes, and
 * `layout` on the survivors moves them rather than reflowing them.
 *
 * `initial={false}` so an already-populated list doesn't play an entrance on
 * mount. New rows arriving later still animate — the entrance means "this is
 * new", and it would be a lie on first paint.
 */
export function AnimatedList({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </div>
  );
}

const ITEM = {
  initial: { opacity: 0, y: -8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  // Leaving is quicker than arriving. A row on its way out is already
  // decided — making it linger reads as the app being slow to obey.
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.16 } },
};

/** One row of an {@link AnimatedList}. Needs a stable `key` from the caller. */
export function AnimatedItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div layout transition={spring.gentle} className={className} {...ITEM}>
      {children}
    </motion.div>
  );
}

/** The same, as a table row — `<div>` is not valid inside `<tbody>`. */
export function AnimatedRow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.tr layout transition={spring.gentle} className={className} {...ITEM}>
      {children}
    </motion.tr>
  );
}

/**
 * A `<tbody>` whose rows animate.
 *
 * `AnimatePresence` renders no element of its own, so it cannot be the thing
 * between `<table>` and its rows — the browser would insert an implicit tbody
 * and React would disagree with it. This keeps the real tbody and puts the
 * presence boundary inside it.
 */
export function AnimatedBody({ children }: { children: ReactNode }) {
  return (
    <tbody>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </tbody>
  );
}
