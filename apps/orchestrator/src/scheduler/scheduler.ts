import type { ScheduledTaskRecord } from "@jarvis/shared";
import {
  createSession,
  getSettings,
  listEnabledScheduledTasks,
  updateScheduledTask,
} from "../db/repo.js";
import { getAgent } from "../db/agentRepo.js";
import { atConcurrencyLimit, isCwdBusy, startSession } from "../sessions/sessionManager.js";
import { startLocalSession } from "../sessions/localSessionManager.js";
import { startOpencodeSession } from "../sessions/opencodeSessionManager.js";
import { startCodexSession } from "../sessions/codexSessionManager.js";
import { getUsageSnapshot } from "../sessions/claudeUsage.js";
import { globalBus } from "../events/globalBus.js";
import { computeNextRun } from "./scheduleTime.js";

export { computeNextRun } from "./scheduleTime.js";

const CHECK_INTERVAL_MS = 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const MAX_RETRIES = 1;

/**
 * When a turn fails, retry on the normal short cadence — unless the account's
 * usage is what just rejected it, in which case that cadence cannot possibly
 * work: nothing succeeds again before the window resets. Real runs burned
 * four retries in under an hour this way (2026-08-19), every one reporting
 * "resets 9:50am" and none able to land before then.
 *
 * `recordRateLimit` (claudeUsage.ts) already captures the SDK's own
 * `rate_limit_event` for the turn that just ran, structured — a reset
 * instant rather than the human-readable string ("resets 9:50am (America/
 * Los_Angeles)") a person sees, so no parsing is needed. `resetsAt` has been
 * observed as both Unix seconds and milliseconds (see ClaudeUsageBadge.tsx),
 * so accept either.
 */
export function nextRetryAt(): Date {
  const binding = getUsageSnapshot().binding;
  if (binding?.status === "rejected" && binding.resetsAt) {
    const resetMs = binding.resetsAt > 1e12 ? binding.resetsAt : binding.resetsAt * 1000;
    // A little slack past the exact reset instant, so the retry doesn't race it.
    const withSlack = resetMs + 60_000;
    if (withSlack > Date.now()) return new Date(withSlack);
  }
  return new Date(Date.now() + RETRY_DELAY_MS);
}

function fireScheduledTask(task: ScheduledTaskRecord): void {
  // The run speaks with its owner's brain: an agent assigned to Ollama runs
  // unattended on Ollama, which is what keeps automations alive when the
  // Claude lane is down (expired login, no subscription). Unknown or missing
  // owners fall back to Claude, as before.
  const owner = task.agentId ? getAgent(task.agentId) : undefined;
  const lane = owner?.brainLane ?? "claude";
  const laneModel = owner?.brainModel ?? null;
  const session = createSession({
    title: `[Scheduled] ${task.prompt.slice(0, 100)}`,
    cwd: task.cwd,
    permissionMode: task.permissionMode,
    allowedTools: task.allowedTools ?? undefined,
    // The run belongs to whichever agent owns the automation, so its persona
    // and its history stay with that agent rather than landing in a shared pile.
    agentId: task.agentId,
    model: lane,
    localModel: lane === "local" ? laneModel ?? undefined : undefined,
    opencodeModel: lane === "opencode" ? laneModel ?? undefined : undefined,
    // Nobody is watching a cron firing at 5am — a local-work approval prompt
    // (e.g. PowerShell, which fell through this gap on 2026-08-24 and stalled
    // two runs for hours) would just sit until the timeout auto-denies it.
    // Structurally can never reach Jarvis's own outbound platform tools; see
    // LOCAL_WORK_TOOLS in sessionManager.ts.
    autoApproveLocalTools: true,
  });
  globalBus.emit("session_updated", session.id);

  const turnTitle = `Automation "${task.prompt.split("\n")[0].slice(0, 60)}"`;
  // Only the Claude lane reports back for the bounded retry below; other
  // lanes surface failures through the normal session-failed path and retry
  // on their next scheduled occurrence. Wiring every lane into the retry
  // callback is future work, not a silent behavior change.
  if (lane === "local") {
    startLocalSession({ id: session.id, prompt: task.prompt, cwd: task.cwd, title: turnTitle, agentId: task.agentId, localModel: laneModel });
  } else if (lane === "opencode") {
    startOpencodeSession({ id: session.id, prompt: task.prompt, cwd: task.cwd, title: turnTitle, agentId: task.agentId, opencodeModel: laneModel });
  } else if (lane === "gpt-5.6-sol") {
    startCodexSession({ id: session.id, prompt: task.prompt, cwd: task.cwd, title: turnTitle, agentId: task.agentId });
  } else {
    void startSession({
      id: session.id,
      prompt: task.prompt,
      cwd: task.cwd,
      permissionMode: task.permissionMode,
      allowedTools: task.allowedTools ?? undefined,
      title: turnTitle,
      agentId: task.agentId,
      autoApproveLocalTools: true,
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
            nextRunAt: nextRetryAt().toISOString(),
          });
        } else {
          updateScheduledTask(task.id, { retryCount: 0 });
        }
        globalBus.emit("automations_changed");
      },
    });
  }

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
