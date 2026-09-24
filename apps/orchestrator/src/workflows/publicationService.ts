import { CHANNEL_BODY_LIMITS, type ContentItemRecord } from "@jarvis/shared";
import { appendSessionEvent, createSession, updateSession } from "../db/repo.js";
import {
  createContentPublicationRun,
  finishContentPublicationRun,
  getWorkflow,
  latestContentPublicationRun,
  updateContentItem,
  updateWorkflow,
} from "../db/workflowRepo.js";
import { getConnection, getConnectionById, getConnectionCredentialsById } from "../db/connectionsRepo.js";
import { workflowAccountIds } from "../db/workflowAccountsRepo.js";
import { atConcurrencyLimit, startSession } from "../sessions/sessionManager.js";
import { sendXPost } from "../platforms/actions.js";
import { globalBus } from "../events/globalBus.js";

export function platformForContent(item: ContentItemRecord): string | null {
  return item.channel === "x" ? "x" : null;
}

/**
 * Which account this content is allowed to reach.
 *
 * The campaign owning the content decides, and nothing else does. A campaign
 * pinned to an account can only ever publish there; an unpinned one falls back
 * to resolving the platform, which returns nothing when several accounts could
 * match rather than choosing between them. Either way the answer comes from the
 * workflow, never from the model — the failure this prevents is one business's
 * content appearing on another business's timeline, publicly and permanently.
 */
export function accountForContent(
  item: ContentItemRecord,
  platformId: string
): { connectionId?: string; reason?: string } {
  const workflow = getWorkflow(item.workflowId);
  if (!workflow) return { reason: "This content has no workflow, so no account is attached to it." };

  const pinnedId = workflowAccountIds(workflow.id).find((id) => getConnectionById(id)?.platformId === platformId);
  if (pinnedId) {
    const pinned = getConnectionById(pinnedId);
    if (!pinned) {
      return { reason: `The account pinned to "${workflow.name}" no longer exists. Re-attach an account to the workflow before publishing.` };
    }
    if (pinned.platformId !== platformId) {
      // Belt and braces: a campaign pinned to a Slack account must never
      // publish an X post just because the channel says so.
      return { reason: `"${workflow.name}" has no ${platformId} account attached, so it cannot publish ${platformId} content.` };
    }
    if (pinned.status !== "connected") {
      return { reason: `The account pinned to "${workflow.name}" is not connected. Test it before publishing.` };
    }
    if (pinned.agentId && workflow.agentId && pinned.agentId !== workflow.agentId) {
      return { reason: `The account pinned to "${workflow.name}" belongs to another agent.` };
    }
    return { connectionId: pinned.id };
  }

  const resolved = getConnection(platformId);
  if (!resolved) {
    return {
      reason: `Several ${platformId} accounts exist and "${workflow.name}" has no account attached. Attach the account it should publish as.`,
    };
  }
  if (resolved.status !== "connected") {
    return { reason: `Connect and test ${platformId.toUpperCase()} before publishing.` };
  }
  return { connectionId: resolved.id };
}

export function contentPublishingReadiness(item: ContentItemRecord): {
  ready: boolean;
  reason?: string;
  platformId?: string;
  connectionId?: string;
} {
  const platformId = platformForContent(item);
  if (!platformId) return { ready: false, reason: `Automatic publishing is not connected for ${item.channel} yet.` };
  const limit = CHANNEL_BODY_LIMITS[item.channel];
  if (limit && item.body.length > limit) {
    return { ready: false, reason: `${item.channel.toUpperCase()} posts must be ${limit} characters or fewer; this draft has ${item.body.length}.` };
  }
  const account = accountForContent(item, platformId);
  if (!account.connectionId) {
    return { ready: false, reason: account.reason ?? `Connect and test ${platformId.toUpperCase()} before publishing.` };
  }
  return { ready: true, platformId, connectionId: account.connectionId };
}

export function publicationPrompt(item: ContentItemRecord): string {
  return `Publish this approved campaign content to X using post_to_x exactly once.

Required post text (preserve it exactly):
---
${item.body}
---

Do not rewrite, shorten, add a link, attach an image, or use any other tool. The outbound tool will pause for the user's one-time approval. If approval is denied or the platform refuses the post, report that plainly and do not try an alternative.`;
}

export function startContentPublication(item: ContentItemRecord): { sessionId: string; runId: string } {
  if (!["review", "scheduled"].includes(item.status)) {
    throw new Error("Content must be reviewed or scheduled before it can be published.");
  }
  const readiness = contentPublishingReadiness(item);
  if (!readiness.ready || !readiness.platformId) throw new Error(readiness.reason ?? "Publishing is not ready.");
  if (atConcurrencyLimit()) throw new Error("Jarvis is at its concurrent run limit. Try again after another run finishes.");
  const previous = latestContentPublicationRun(item.id);
  if (previous?.status === "running") throw new Error("A publishing run is already active for this content.");
  if (previous?.status === "published") throw new Error("This content already has a confirmed publication.");

  const session = createSession({
    title: `Publish: ${item.title}`,
    cwd: process.cwd(),
    permissionMode: "default",
    allowedTools: [],
  });
  const run = createContentPublicationRun({
    contentItemId: item.id,
    sessionId: session.id,
    platformId: readiness.platformId,
  });
  globalBus.emit("session_updated", session.id);
  globalBus.emit("workflows_changed");
  void startSession({
    id: session.id,
    prompt: publicationPrompt(item),
    cwd: session.cwd,
    permissionMode: "default",
    allowedTools: [],
    title: session.title,
    // The campaign already decided the account. Handing the session only that
    // one means there is no second account for the model to reach, rather than
    // a rule asking it not to.
    connectionId: readiness.connectionId,
  });
  return { sessionId: session.id, runId: run.id };
}

export interface AutopilotPublishOutcome {
  published: boolean;
  /** True when the failure should switch the workflow's auto-publish off. */
  tripped: boolean;
  reason: string;
  externalPostId?: string | null;
}

/**
 * Publishes due scheduled content without a per-post approval tap, under a
 * workflow's stored autopilot policy — the consent the operator gave once in
 * the UI rather than silence. Deliberately NOT a session: no model is
 * consulted, so there is no prompt to inject into, no per-turn cost, and the
 * exact reviewed text is what goes out (a session is only ever asked to
 * preserve it; this path cannot do otherwise).
 *
 * Every billable and stateful step still flows through the same guards as
 * the approval path — readiness preflight, daily caps, duplicate detection,
 * the per-platform lock, and the ledger write all run identically. The only
 * thing the policy replaces is the human tap, and any failure flips the
 * policy back off (except an exhausted daily cap, which clears overnight)
 * and notifies loudly. Text only: items needing images stay on the manual
 * path by construction, since there is nowhere to attach one here.
 */
export async function autoPublishContent(item: ContentItemRecord, nowIso?: string): Promise<AutopilotPublishOutcome> {
  const startedAt = Date.now();
  const now = nowIso ?? new Date().toISOString();
  const workflow = getWorkflow(item.workflowId);
  if (!workflow || !workflow.autopilot || !workflow.autopilotPublish || workflow.status !== "active") {
    return { published: false, tripped: false, reason: "Autopilot publishing is not enabled for this workflow." };
  }
  if (item.status !== "scheduled" || !item.scheduledFor || item.scheduledFor > now) {
    return { published: false, tripped: false, reason: "This content is not due." };
  }
  const readiness = contentPublishingReadiness(item);
  if (!readiness.ready || !readiness.platformId || !readiness.connectionId) {
    return { published: false, tripped: false, reason: readiness.reason ?? "Publishing is not ready." };
  }
  const previous = latestContentPublicationRun(item.id);
  if (previous?.status === "running") {
    return { published: false, tripped: false, reason: "A publishing run is already active for this content." };
  }
  if (previous?.status === "published") {
    return { published: false, tripped: false, reason: "This content already has a confirmed publication." };
  }
  const creds = getConnectionCredentialsById(readiness.connectionId);
  if (!creds) {
    return { published: false, tripped: true, reason: "The pinned account's credentials are unavailable." };
  }

  // The audit session: a plain row recording that the policy published this,
  // never a model turn. It renders in Brain runs like any other run, with no
  // turns and no cost, so unattended publishing stays visible.
  const session = createSession({
    title: `Autopilot publish: ${item.title}`,
    cwd: process.cwd(),
    permissionMode: "default",
    allowedTools: [],
  });
  createContentPublicationRun({
    contentItemId: item.id,
    sessionId: session.id,
    platformId: readiness.platformId,
  });
  globalBus.emit("session_updated", session.id);
  appendSessionEvent(session.id, "user", {
    message: {
      role: "user",
      content: `Autopilot publish of "${item.title}" under the "${workflow.name}" policy (${item.body.length} characters).`,
    },
  });

  const finish = (ok: boolean, text: string, externalPostId?: string | null) => {
    appendSessionEvent(session.id, "result", {
      is_error: !ok,
      duration_ms: Date.now() - startedAt,
      ...(ok ? { result: text } : { errors: [text] }),
      model: "autopilot",
    });
    updateSession(session.id, {
      status: ok ? "completed" : "error",
      summary: text.replace(/\s+/g, " ").slice(0, 280),
      ...(ok ? {} : { errorMessage: text }),
      currentActivity: null,
    });
    globalBus.emit("session_updated", session.id);
    globalBus.emit("workflows_changed");
  };

  const outcome = await sendXPost(creds, readiness.connectionId, { text: item.body }, session.id);
  if (outcome.ok) {
    updateContentItem(item.id, { status: "published" });
    finishContentPublicationRun(session.id, "published", undefined, outcome.externalPostId);
    finish(true, `Posted to X. Post id: ${outcome.externalPostId ?? "unknown"}.`, outcome.externalPostId);
    return { published: true, tripped: false, reason: "Posted.", externalPostId: outcome.externalPostId };
  }

  const failure = (() => {
    switch (outcome.code) {
      case "capped":
        return { message: "Daily X limit reached — will retry after the cap resets.", trip: false };
      case "duplicate":
        return { message: "This exact text was already posted within the last 30 days; it will never succeed.", trip: true };
      case "credits":
        return { message: "X API credits are depleted — fund them in the X Developer Console, then re-enable autopilot publishing.", trip: true };
      case "forbidden":
        return { message: "X refused with 403 — the access token is probably read-only.", trip: true };
      case "rate_limited":
        // Retrying every 60 seconds into a rate limit only deepens it.
        return { message: "X rate limit reached.", trip: true };
      default:
        return { message: `X refused the post: ${outcome.detail}`, trip: true };
    }
  })();
  finishContentPublicationRun(session.id, "failed", failure.message);
  finish(false, failure.message);
  if (failure.trip) updateWorkflow(workflow.id, { autopilotPublish: false });
  return { published: false, tripped: failure.trip, reason: failure.message };
}
