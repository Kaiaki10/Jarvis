import {
  finishContentPublicationRun,
  getContentItem,
  getContentPublicationRunBySession,
  updateContentItem,
} from "../db/workflowRepo.js";
import { externalPostIdForSession, hasSuccessfulActionForSession } from "../platforms/spendGuard.js";
import { notify } from "../notifications/notifier.js";

export function reconcileContentPublication(input: { sessionId: string; ok: boolean }): boolean {
  const run = getContentPublicationRunBySession(input.sessionId);
  if (!run || run.status !== "running") return false;
  const item = getContentItem(run.contentItemId);
  const published = input.ok && hasSuccessfulActionForSession(input.sessionId, run.platformId);

  if (published && item) {
    updateContentItem(item.id, { status: "published" });
    // Carried from the ledger onto the run, so a published post stays
    // addressable. Without it the post can never be looked up to measure.
    finishContentPublicationRun(
      input.sessionId,
      "published",
      undefined,
      externalPostIdForSession(input.sessionId, run.platformId)
    );
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
