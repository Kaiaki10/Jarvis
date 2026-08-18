import {
  finishContentPublicationRun,
  getContentItem,
  getContentPublicationRunBySession,
  updateContentItem,
} from "../db/campaignRepo.js";
import { hasSuccessfulActionForSession } from "../platforms/spendGuard.js";
import { notify } from "../notifications/notifier.js";

export function reconcileContentPublication(input: { sessionId: string; ok: boolean }): boolean {
  const run = getContentPublicationRunBySession(input.sessionId);
  if (!run || run.status !== "running") return false;
  const item = getContentItem(run.contentItemId);
  const published = input.ok && hasSuccessfulActionForSession(input.sessionId, run.platformId);

  if (published && item) {
    updateContentItem(item.id, { status: "published" });
    finishContentPublicationRun(input.sessionId, "published");
  } else {
    const message = input.ok
      ? "The run ended without a confirmed platform action. It may have been denied or blocked by a guardrail."
      : "The publishing run failed before the platform confirmed the action.";
    finishContentPublicationRun(input.sessionId, "failed", message);
    notify({
      type: "automation_failed",
      severity: "warning",
      title: "Campaign content was not published",
      body: `${item?.title ?? "A scheduled content item"}: ${message}`,
      sessionId: input.sessionId,
    });
  }
  return true;
}
