import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db.js";
import { externalPostIdForSession, recordAction } from "../platforms/spendGuard.js";
import {
  createContentItem,
  createContentPublicationRun,
  finishContentPublicationRun,
  getContentPublicationRunBySession,
} from "../db/workflowRepo.js";
import { createWorkflow } from "../db/workflowRepo.js";
import { createSession } from "../db/repo.js";

function seed() {
  const workflow = createWorkflow({
    name: "W", objective: "o", audience: "a", offer: "f",
    channels: ["x"], primaryMetric: "m", approvalPolicy: "each_item",
  });
  const item = createContentItem({
    workflowId: workflow.id, title: "t", body: "b", format: "social_post", channel: "x",
  });
  const session = createSession({ title: "publish", cwd: ".", permissionMode: "default" });
  createContentPublicationRun({ contentItemId: item.id, sessionId: session.id, platformId: "x" });
  return { session, item };
}

describe("published post id capture", () => {
  beforeEach(() => {
    db.exec("DELETE FROM platform_actions");
  });

  it("keeps the platform's post id against the action", () => {
    const { session } = seed();
    recordAction("x", "post_to_x", session.id, null, "1957000000000000001");
    expect(externalPostIdForSession(session.id, "x")).toBe("1957000000000000001");
  });

  it("returns null when the platform gave no id, rather than inventing one", () => {
    const { session } = seed();
    recordAction("x", "post_to_x", session.id, null, null);
    expect(externalPostIdForSession(session.id, "x")).toBeNull();
  });

  it("does not read another platform's id for the same session", () => {
    const { session } = seed();
    recordAction("slack", "post_to_slack", session.id, null, "slack-123");
    expect(externalPostIdForSession(session.id, "x")).toBeNull();
  });

  it("carries the id onto the publication run when it succeeds", () => {
    const { session } = seed();
    recordAction("x", "post_to_x", session.id, null, "1957000000000000002");
    finishContentPublicationRun(
      session.id,
      "published",
      undefined,
      externalPostIdForSession(session.id, "x")
    );
    expect(getContentPublicationRunBySession(session.id)?.externalPostId).toBe("1957000000000000002");
  });

  it("leaves a failed run with no post id — nothing was published to measure", () => {
    const { session } = seed();
    finishContentPublicationRun(session.id, "failed", "denied");
    const run = getContentPublicationRunBySession(session.id);
    expect(run?.status).toBe("failed");
    expect(run?.externalPostId).toBeNull();
  });

  it("takes the most recent id when a session recorded more than one", () => {
    const { session } = seed();
    recordAction("x", "post_to_x", session.id, null, "first");
    recordAction("x", "post_to_x", session.id, null, "second");
    expect(externalPostIdForSession(session.id, "x")).toBe("second");
  });
});
