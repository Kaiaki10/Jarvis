"use client";

import { motion } from "motion/react";
import { spring } from "./MotionProvider";

/**
 * A bar that fills to a fraction, and springs when that fraction changes.
 *
 * Scaled rather than resized. Animating `width` relayouts every ancestor on
 * every frame, which on a page of cards is the difference between smooth and
 * visibly stepping; a transform is composited and costs the rest of the page
 * nothing.
 *
 * The value is a fraction, not a percentage, and is clamped here — a meter that
 * renders past its own track would be reporting a number the design cannot
 * show, which is worse than reporting the cap.
 */
export function Meter({
  value,
  barClassName = "bg-accent",
  className = "",
}: {
  /** 0–1. Values outside the range are clamped. */
  value: number;
  /** Tone of the fill, as a Tailwind background class. */
  barClassName?: string;
  className?: string;
}) {
  const fraction = Math.max(0, Math.min(1, value));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] ${className}`}>
      <motion.div
        className={`h-full w-full origin-left rounded-full ${barClassName}`}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: fraction }}
        transition={spring.gentle}
      />
    </div>
  );
}
