import { getSettings } from "../db/repo.js";
import { listDueContentItems, listContentItems, listWorkflows, updateContentItem } from "../db/workflowRepo.js";
import { notify } from "../notifications/notifier.js";
import { globalBus } from "../events/globalBus.js";
import { startContentPublication, contentPublishingReadiness } from "./publicationService.js";

const CHECK_INTERVAL_MS = 60_000;

/**
 * Items already reported as stuck, so a permanently blocked post produces one
 * notification rather than one every minute for as long as it stays blocked.
 * Deliberately in memory: a restart re-reporting a still-broken item is useful,
 * and a persisted table of suppressed warnings is its own thing to go stale.
 */
const reportedBlocked = new Set<string>();

export function tickContentPublishing(now = new Date()): boolean {
  if (!getSettings().automationsEnabled) return false;
  for (const item of listDueContentItems(now.toISOString())) {
    const readiness = contentPublishingReadiness(item);
    if (!readiness.ready) {
      // Previously a bare `continue`. A post whose account was detached, or
      // whose body is over the channel limit, sat scheduled forever with
      // nothing anywhere saying why — the failure was invisible at exactly the
      // moment it mattered.
      if (!reportedBlocked.has(item.id)) {
        reportedBlocked.add(item.id);
        notify({
          type: "automation_failed",
          severity: "warning",
          title: "Scheduled content cannot publish",
          body: `"${item.title}" was due to publish but is blocked: ${readiness.reason ?? "it is not ready."}`,
        });
      }
      continue;
    }
    reportedBlocked.delete(item.id);
    try {
      startContentPublication(item);
      return true;
    } catch (error) {
      console.error(`[workflows] could not start scheduled publication for "${item.title}":`, error);
      return false;
    }
  }
  return false;
}

/**
 * Autopilot: gives approved content a publish time without a human choosing one.
 *
 * Off by default, and it automates *timing only* — an item still has to be
 * moved to `review` by a person, and publishing still hits the outbound
 * approval gate. What this removes is the chore of picking a datetime for every
 * post, not the consent step.
 *
 * Only `active` workflows are considered, so pausing stops new scheduling as
 * well as publishing.
 */
export function tickAutopilot(now = new Date()): number {
  if (!getSettings().automationsEnabled) return 0;
  let scheduled = 0;

  for (const workflow of listWorkflows()) {
    if (!workflow.autopilot || workflow.status !== "active") continue;

    const content = listContentItems(workflow.id);
    const intervalMs = Math.max(1, workflow.autopilotIntervalHours) * 3_600_000;

    // The next slot is measured from the latest time already claimed, so a
    // cadence stays a cadence instead of stacking everything on the next tick.
    const claimed = content
      .map((item) => item.scheduledFor ?? item.publishedAt)
      .filter((stamp): stamp is string => Boolean(stamp))
      .map((stamp) => Date.parse(stamp))
      .filter((ms) => !Number.isNaN(ms));
    const lastClaimed = claimed.length ? Math.max(...claimed) : null;

    const ready = content
      .filter((item) => item.status === "review" && !item.scheduledFor)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!ready.length) continue;

    let slot = Math.max(lastClaimed !== null ? lastClaimed + intervalMs : now.getTime(), now.getTime());
    for (const item of ready) {
      updateContentItem(item.id, {
        status: "scheduled",
        scheduledFor: new Date(slot).toISOString(),
      });
      slot += intervalMs;
      scheduled += 1;
    }
  }

  if (scheduled > 0) globalBus.emit("workflows_changed");
  return scheduled;
}

export function startContentPublishingScheduler(): void {
  tickContentPublishing();
  tickAutopilot();
  setInterval(() => {
    tickAutopilot();
    tickContentPublishing();
  }, CHECK_INTERVAL_MS);
}
