"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from its previous value to the new one.
 *
 * A dashboard number that jumps gives you no sense of which direction it moved
 * or whether it changed at all when you weren't looking. Counting draws the eye
 * to what actually updated.
 *
 * Animates on change, not on mount — the first paint shows the real number
 * immediately rather than making you watch it climb from zero every page load.
 */
export function CountUp({
  value,
  duration = 520,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = previous.current;
    const to = value;
    previous.current = value;

    if (from === to) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Big jumps aren't a "count", they're a reload — snap instead of spinning
    // through hundreds of intermediate values nobody reads.
    if (reduced || Math.abs(to - from) > 200) {
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic: quick to move, settles gently on the final value.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = null;
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [value, duration]);

  return (
    <span className={`tabular-nums ${className}`}>{display}</span>
  );
}
