"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "./MotionProvider";

/**
 * Gives a control weight: it lifts under the cursor and gives under the press.
 *
 * The press is the half that matters. A hover lift is decoration, but something
 * that yields when clicked is the difference between a picture of a button and
 * a thing you touched — the click already registered, and this says so before
 * the response arrives.
 *
 * Wraps whatever it's given rather than rendering a button, so the child keeps
 * its own semantics and keyboard behaviour.
 */
export function Pressable({
  children,
  className = "",
  disabled = false,
  lift = 2,
}: {
  children: ReactNode;
  className?: string;
  /** Skips the animation entirely — a dead control must not feel alive. */
  disabled?: boolean;
  /** How far it rises, in px. Cards lift more than inline controls. */
  lift?: number;
}) {
  if (disabled) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      whileHover={{ y: -lift }}
      whileTap={{ scale: 0.985, y: 0 }}
      transition={spring.snappy}
    >
      {children}
    </motion.div>
  );
}
