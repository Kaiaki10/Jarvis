import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-publication-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
});

async function fixture() {
  const workflows = await import("../db/workflowRepo.js");
  const sessions = await import("../db/repo.js");
  const campaign = workflows.createWorkflow({
    name: "Launch",
    objective: "Create demand",
    audience: "Operators",
    offer: "A walkthrough",
    channels: ["x"],
    primaryMetric: "Requests",
    approvalPolicy: "each_item",
  });
  const item = workflows.createContentItem({
    workflowId: campaign.id,
    title: "Launch post",
    body: "A concise launch post.",
    format: "social_post",
    channel: "x",
  });
  workflows.updateContentItem(item.id, { status: "review" });
  const session = sessions.createSession({ title: "Publish", cwd: process.cwd(), permissionMode: "default" });
  workflows.createContentPublicationRun({ contentItemId: item.id, sessionId: session.id, platformId: "x" });
  return { workflows, sessions, item, session };
}

describe("content publication reconciliation", () => {
  it("marks content published only when the platform ledger confirms success", async () => {
    const { workflows, item, session } = await fixture();
    const { recordAction } = await import("../platforms/spendGuard.js");
    const { reconcileContentPublication } = await import("./publicationReconciler.js");
    recordAction("x", "post_to_x", session.id, "hash");
    expect(reconcileContentPublication({ sessionId: session.id, ok: true })).toBe(true);
    expect(workflows.getContentItem(item.id)?.status).toBe("published");
    expect(workflows.getContentPublicationRunBySession(session.id)?.status).toBe("published");
  });

  it("fails closed when a run finishes without a confirmed outbound action", async () => {
    const { workflows, sessions, item, session } = await fixture();
    sessions.updateSettings({ notifyOnDesktop: false });
    const { reconcileContentPublication } = await import("./publicationReconciler.js");
    reconcileContentPublication({ sessionId: session.id, ok: true });
    expect(workflows.getContentItem(item.id)?.status).toBe("review");
    expect(workflows.getContentPublicationRunBySession(session.id)?.status).toBe("failed");
  });

  it("selects only due content that has never had a publication attempt", async () => {
    const workflows = await import("../db/workflowRepo.js");
    const campaign = workflows.createWorkflow({ name: "Calendar", objective: "Publish", audience: "Owners", offer: "Guide", channels: ["x"], primaryMetric: "Reads", approvalPolicy: "each_item" });
    // Active: due content only publishes for a live workflow, which is what
    // makes pausing work. This test is about the never-attempted filter.
    workflows.updateWorkflow(campaign.id, { status: "active" });
    const item = workflows.createContentItem({ workflowId: campaign.id, title: "Due", body: "Due now", format: "social_post", channel: "x" });
    workflows.updateContentItem(item.id, { status: "scheduled", scheduledFor: new Date(Date.now() - 1_000).toISOString() });
    expect(workflows.listDueContentItems(new Date().toISOString()).map((entry) => entry.id)).toContain(item.id);
  });
});
