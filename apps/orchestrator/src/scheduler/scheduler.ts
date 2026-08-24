import type { ScheduledTaskRecord } from "@jarvis/shared";
import {
  createSession,
  getSettings,
  listEnabledScheduledTasks,
  updateScheduledTask,
} from "../db/repo.js";
import { atConcurrencyLimit, isCwdBusy, startSession } from "../sessions/sessionManager.js";
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
    // The run belongs to whichever agent owns the automation, so its persona
    // and its history stay with that agent rather than landing in a shared pile.
    agentId: task.agentId,
  });
  globalBus.emit("session_updated", session.id);

  void startSession({
    id: session.id,
    prompt: task.prompt,
    cwd: task.cwd,
    permissionMode: task.permissionMode,
    allowedTools: task.allowedTools ?? undefined,
    title: `Automation "${task.prompt.split("\n")[0].slice(0, 60)}"`,
    agentId: task.agentId,
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

/** Exported for tests; `startScheduler` is the real entry point. */
export function tick(): void {
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
    // Being under the global cap doesn't mean this specific task can run: a
    // different scheduled task can already have a turn in flight in the same
    // cwd (multiple automations targeting the shared jarvis-lab worktree, for
    // instance), and firing another into it risks two agents editing and
    // committing in the same git working directory at once. That only rules
    // out *this* task, so try the next due one rather than stopping the tick.
    if (isCwdBusy(task.cwd)) {
      console.warn(
        `[scheduler] "${task.cwd}" already has a run in flight, deferring "${task.prompt.slice(0, 60)}"`
      );
      continue;
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
