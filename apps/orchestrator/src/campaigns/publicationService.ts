import type { ContentItemRecord } from "@jarvis/shared";
import { createSession } from "../db/repo.js";
import {
  createContentPublicationRun,
  latestContentPublicationRun,
} from "../db/campaignRepo.js";
import { getConnection } from "../db/connectionsRepo.js";
import { atConcurrencyLimit, startSession } from "../sessions/sessionManager.js";
import { globalBus } from "../events/globalBus.js";

export function platformForContent(item: ContentItemRecord): string | null {
  return item.channel === "x" ? "x" : null;
}

export function contentPublishingReadiness(item: ContentItemRecord): { ready: boolean; reason?: string; platformId?: string } {
  const platformId = platformForContent(item);
  if (!platformId) return { ready: false, reason: `Automatic publishing is not connected for ${item.channel} yet.` };
  if (item.channel === "x" && item.body.length > 280) {
    return { ready: false, reason: `X posts must be 280 characters or fewer; this draft has ${item.body.length}.` };
  }
  const connection = getConnection(platformId);
  if (connection?.status !== "connected") {
    return { ready: false, reason: `Connect and test ${platformId.toUpperCase()} before publishing.` };
  }
  return { ready: true, platformId };
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
  globalBus.emit("campaigns_changed");
  void startSession({
    id: session.id,
    prompt: publicationPrompt(item),
    cwd: session.cwd,
    permissionMode: "default",
    allowedTools: [],
    title: session.title,
  });
  return { sessionId: session.id, runId: run.id };
}
