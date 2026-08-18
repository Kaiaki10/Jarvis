"use client";

import { useCallback, useRef, type ReactNode } from "react";

/**
 * A soft highlight that follows the pointer across a surface.
 *
 * Writes CSS custom properties rather than re-rendering — pointer moves fire
 * dozens of times a second, and a setState on each would make the whole subtree
 * re-render while you're just moving the mouse. Reads are batched into a rAF so
 * layout is measured at most once a frame.
 *
 * Inert without a pointer: it never activates on touch or keyboard, so nothing
 * depends on it.
 */
export function Spotlight({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const point = useRef({ x: 0, y: 0 });

  const apply = useCallback(() => {
    frame.current = null;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((point.current.x - rect.left) / rect.width) * 100;
    const y = ((point.current.y - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Fine pointers only — a touch "hover" would light up and stay lit.
      if (e.pointerType !== "mouse") return;
      point.current = { x: e.clientX, y: e.clientY };
      ref.current?.setAttribute("data-active", "true");
      if (frame.current === null) {
        frame.current = requestAnimationFrame(apply);
      }
    },
    [apply]
  );

  const onPointerLeave = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    ref.current?.setAttribute("data-active", "false");
  }, []);

  return (
    <div
      ref={ref}
      className={`material-spotlight ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  );
}
