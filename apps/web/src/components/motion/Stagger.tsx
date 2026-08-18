import type { ReactNode } from "react";

/**
 * Sections rise into place in sequence rather than all at once.
 *
 * The delay is capped: past a few steps the wait stops reading as polish and
 * starts reading as the page being slow. Runs on the server too — this is pure
 * CSS, no client JS and no layout shift.
 */
export function Stagger({
  index = 0,
  children,
  className = "",
}: {
  index?: number;
  children: ReactNode;
  className?: string;
}) {
  const delayMs = Math.min(index, 6) * 55;
  return (
    <div
      className={`animate-rise-in ${className}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}
