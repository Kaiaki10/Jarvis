"use client";

import { useCallback, useState } from "react";

export interface Dialog {
  /** Whether the dialog is showing. Pass straight to `Overlay`'s `open`. */
  open: boolean;
  /** Changes on every open. Use as the dialog's `key`. */
  key: number;
  show: () => void;
  hide: () => void;
}

/**
 * An open/closed flag that also hands out a fresh key each time it opens.
 *
 * A dialog has to stay mounted while it closes, or React removes it before its
 * exit animation can run. That costs something conditional rendering gave for
 * free: a form that unmounts on close starts empty next time. Left alone, a
 * dialog you cancelled would reopen still holding the draft you abandoned.
 *
 * Remounting on open restores the old behaviour without giving up the exit —
 * the key is stable for the whole of the closing animation, and only changes
 * when the dialog is opened again.
 */
export function useDialog(): Dialog {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);

  const show = useCallback(() => {
    setKey((n) => n + 1);
    setOpen(true);
  }, []);

  const hide = useCallback(() => setOpen(false), []);

  return { open, key, show, hide };
}
