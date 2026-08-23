"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Swaps one view for another by dissolving between them.
 *
 * Loading states are the case this exists for: a skeleton replaced outright
 * flashes, and the eye reads the flash as the page starting over. Crossfading
 * says the same content arrived, which is what actually happened.
 *
 * `mode="wait"` so the outgoing view finishes before the incoming one starts —
 * overlapping two states of the same panel reads as a glitch, not a transition.
 * Change `viewKey` to trigger it; identical keys are left alone.
 */
export function Crossfade({
  viewKey,
  children,
  className = "",
}: {
  viewKey: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={viewKey}
        className={className}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
