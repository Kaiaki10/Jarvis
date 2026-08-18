import type { ScheduledTaskRecord } from "@jarvis/shared";
import {
  createSession,
  getSettings,
  listEnabledScheduledTasks,
  updateScheduledTask,
} from "../db/repo.js";
import { atConcurrencyLimit, startSession } from "../sessions/sessionManager.js";
import { globalBus } from "../events/globalBus.js";

const CHECK_INTERVAL_MS = 60_000;

/** Next local time matching timeOfDay ("HH:MM") on one of daysOfWeek (0=Sun..6=Sat) strictly after `from`. */
export function computeNextRun(
  timeOfDay: string,
  daysOfWeek: number[],
  from: Date
): Date | null {
  if (!daysOfWeek.length) return null;
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate <= from) continue;
    if (daysOfWeek.includes(candidate.getDay())) {
      return candidate;
    }
  }
  return null;
}

function fireScheduledTask(task: ScheduledTaskRecord): void {
  const session = createSession({
    title: `[Scheduled] ${task.prompt.slice(0, 100)}`,
    cwd: task.cwd,
    permissionMode: task.permissionMode,
    allowedTools: task.allowedTools ?? undefined,
  });
  globalBus.emit("session_updated", session.id);

  void startSession({
    id: session.id,
    prompt: task.prompt,
    cwd: task.cwd,
    permissionMode: task.permissionMode,
    allowedTools: task.allowedTools ?? undefined,
  });

  const now = new Date();
  const next = computeNextRun(task.timeOfDay, task.daysOfWeek, now);
  updateScheduledTask(task.id, {
    lastRunAt: now.toISOString(),
    lastSessionId: session.id,
    nextRunAt: next ? next.toISOString() : null,
  });
}

function tick(): void {
  if (!getSettings().automationsEnabled) return;

  const now = new Date();
  for (const task of listEnabledScheduledTasks()) {
    if (!task.nextRunAt || new Date(task.nextRunAt) > now) continue;
    // Leave nextRunAt untouched when we're at capacity so the run isn't lost —
    // the next tick retries it rather than silently skipping the day.
    if (atConcurrencyLimit()) {
      console.warn(
        `[scheduler] at concurrency limit, deferring "${task.prompt.slice(0, 60)}"`
      );
      return;
    }
    fireScheduledTask(task);
  }
}

// Fires anything overdue immediately (e.g. the process was off when a run was
// due), then checks every minute for real. Only fires while this process is
// running — there is no wake-from-sleep or system-level trigger behind it.
export function startScheduler(): void {
  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}
