"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { spring } from "./MotionProvider";

/**
 * A modal's backdrop and panel, with the entrance and the exit.
 *
 * The exit is why this exists. A dialog that vanishes on close gives no sense of
 * where it went, and the page underneath appears to jump forward; letting it
 * fall back and fade says it was dismissed. React unmounts too early for CSS to
 * express that, so `AnimatePresence` holds the panel until it has finished.
 *
 * Stays mounted and takes `open` rather than being rendered conditionally —
 * conditional rendering is exactly what removes the element before it can
 * animate out.
 *
 * Escape closes it, and the backdrop is a real button so a pointer dismiss and
 * a keyboard dismiss go through the same path.
 */
export function Overlay({
  open,
  onDismiss,
  children,
  labelledBy,
}: {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
  /** id of the element naming this dialog, for screen readers. */
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Covers the screen so a click anywhere outside dismisses, without
              the panel's own clicks having to stop propagating.

              Ordered before the panel rather than pushed behind it with a
              negative z-index: a negative z-index would put this behind its own
              parent's background, which paints over it and swallows the click.
              Later siblings paint on top, so DOM order alone is enough. */}
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            className="absolute inset-0 cursor-default"
            onClick={onDismiss}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            // `relative` is load-bearing: at rest Motion may drop the transform
            // entirely, and a static panel would sit *below* the absolutely
            // positioned backdrop button that precedes it.
            className="relative w-full max-w-2xl"
            // Rises slightly and settles. Scaling from much smaller reads as a
            // zoom effect; this reads as the panel coming forward.
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }}
            transition={spring.snappy}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
