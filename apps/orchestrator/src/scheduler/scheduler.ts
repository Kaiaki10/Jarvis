import type { ScheduledTaskRecord } from "@jarvis/shared";
import {
  createSession,
  getSettings,
  listEnabledScheduledTasks,
  updateScheduledTask,
} from "../db/repo.js";
import { atConcurrencyLimit, startSession } from "../sessions/sessionManager.js";
import { globalBus } from "../events/globalBus.js";
import { computeNextRun } from "./scheduleTime.js";

export { computeNextRun } from "./scheduleTime.js";

const CHECK_INTERVAL_MS = 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const MAX_RETRIES = 1;

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
    title: `Automation "${task.prompt.split("\n")[0].slice(0, 60)}"`,
    onTurnFinished: (ok) => {
      if (ok) {
        if (task.retryCount) {
          updateScheduledTask(task.id, { retryCount: 0 });
          globalBus.emit("automations_changed");
        }
        return;
      }
      if (task.retryCount < MAX_RETRIES) {
        updateScheduledTask(task.id, {
          retryCount: task.retryCount + 1,
          nextRunAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
        });
      } else {
        updateScheduledTask(task.id, { retryCount: 0 });
      }
      globalBus.emit("automations_changed");
    },
  });

  const now = new Date();
  const next = computeNextRun(task.timeOfDay, task.daysOfWeek, now);
  updateScheduledTask(task.id, {
    lastRunAt: now.toISOString(),
    lastSessionId: session.id,
    nextRunAt: next ? next.toISOString() : null,
  });
  globalBus.emit("automations_changed");
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
    // Pace catch-up after downtime so overdue work cannot stampede the service.
    return;
  }
}

// Fires anything overdue immediately (e.g. the process was off when a run was
// due), then checks every minute for real. Only fires while this process is
// running — there is no wake-from-sleep or system-level trigger behind it.
export function startScheduler(): void {
  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}
