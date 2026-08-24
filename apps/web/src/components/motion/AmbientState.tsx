"use client";

import { useSessionsList } from "@/lib/hooks";

type Ambient = "idle" | "working" | "attention";

/**
 * What the system is doing, said by the room rather than by a badge.
 *
 * Jarvis runs unattended. You can be on any page when a session starts, needs a
 * decision, or finishes, and until now the only way to know was to look
 * somewhere specific. This makes it peripheral: the background warms while work
 * is running, and shifts amber when something is waiting on you.
 *
 * Never load-bearing, and never the only signal — the sidebar badge, the
 * notifications count and the run list all still say the same thing in words.
 * This is `aria-hidden` for that reason: to a screen reader it would be noise
 * duplicating information that is already properly labelled elsewhere.
 *
 * Reads state rather than animating on events, so it is always telling the
 * truth about *now* rather than about the last thing that happened.
 */
export function AmbientState() {
  const { sessions } = useSessionsList();

  // Attention outranks work: a run that is blocked on you is the one thing here
  // worth interrupting for, and a busy system should not bury it.
  const state: Ambient = sessions.some((session) => session.status === "waiting_permission")
    ? "attention"
    : sessions.some((session) => session.status === "running" || session.status === "starting")
      ? "working"
      : "idle";

  return <div className="ambient-state" data-state={state} aria-hidden="true" />;
}
