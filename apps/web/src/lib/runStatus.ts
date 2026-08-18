import type { ScheduledTaskRecord, SessionRecord, SessionStatus } from "@jarvis/shared";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface RunOutcome {
  label: string;
  tone: Tone;
  /** True when a human needs to do something before this can progress. */
  needsAttention: boolean;
}

const OUTCOMES: Record<SessionStatus, RunOutcome> = {
  starting: { label: "Starting", tone: "accent", needsAttention: false },
  running: { label: "Running", tone: "accent", needsAttention: false },
  waiting_permission: { label: "Needs approval", tone: "warning", needsAttention: true },
  idle: { label: "Succeeded", tone: "success", needsAttention: false },
  completed: { label: "Succeeded", tone: "success", needsAttention: false },
  error: { label: "Failed", tone: "danger", needsAttention: true },
  interrupted: { label: "Interrupted", tone: "danger", needsAttention: true },
  stopped: { label: "Stopped", tone: "neutral", needsAttention: false },
};

export function outcomeForStatus(status: SessionStatus): RunOutcome {
  return OUTCOMES[status];
}

export function lastRunOutcome(
  task: ScheduledTaskRecord,
  sessionById: Map<string, SessionRecord>
): RunOutcome | null {
  if (!task.lastSessionId) return null;
  const session = sessionById.get(task.lastSessionId);
  return session ? outcomeForStatus(session.status) : null;
}

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function daysLabel(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.length === 7) return "Daily";
  if (sorted.length === 5 && sorted.every((d, i) => d === WEEKDAYS[i])) return "Weekdays";
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return "Weekends";
  return sorted.map((d) => DAY_LABELS[d]).join(" ");
}

export function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
