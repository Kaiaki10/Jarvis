import type { SessionStatus } from "@jarvis/shared";

/**
 * How a run's status is shown, in one place.
 *
 * The list and the detail header used to disagree — the list said "Needs
 * approval", the header printed the raw `waiting_permission`. That was already
 * worth fixing, and became load-bearing once the two are a morph pair: the
 * badge animates between them, so a difference in wording is a visible change
 * of content mid-flight rather than a discrepancy you have to catch.
 */
export const STATUS_TONE: Record<
  SessionStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  starting: "warning",
  running: "accent",
  waiting_permission: "warning",
  idle: "success",
  completed: "neutral",
  error: "danger",
  stopped: "neutral",
  interrupted: "danger",
};

export const STATUS_LABEL: Record<SessionStatus, string> = {
  starting: "Starting",
  running: "Running",
  waiting_permission: "Needs approval",
  idle: "Idle",
  completed: "Completed",
  error: "Error",
  stopped: "Stopped",
  interrupted: "Interrupted",
};
