"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveals its children as they scroll into view.
 *
 * Fires once and stays revealed. A dashboard is something you scroll up and
 * down inside while working — content that re-animates every time it crosses
 * the fold is the difference between "considered" and "won't sit still".
 *
 * Falls back to visible when IntersectionObserver is unavailable, so content
 * can never be stranded invisible.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  /** How far into the viewport before it triggers. Larger = later. */
  margin = "0px 0px -12% 0px",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  margin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    // Already in view on first paint (above the fold) — reveal without waiting
    // for a scroll that may never come.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: margin, threshold: 0.01 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [margin]);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      data-visible={visible}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
