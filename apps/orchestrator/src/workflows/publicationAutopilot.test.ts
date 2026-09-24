import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-autopilot-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const X_CREDS = {
  apiKey: "key",
  apiSecret: "secret",
  accessToken: "token",
  accessTokenSecret: "tokensecret",
};

function mockXFetch(status: number, body: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fixture(body = "Autopilot posts exactly this reviewed text.") {
  const workflows = await import("../db/workflowRepo.js");
  const { saveConnection, recordTestResult } = await import("../db/connectionsRepo.js");
  const { attachWorkflowAccount } = await import("../db/workflowAccountsRepo.js");
  const connection = saveConnection("x", X_CREDS, { forceNew: true });
  recordTestResult(connection.id, true, null, null);
  const campaign = workflows.createWorkflow({
    name: `Autopilot ${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    objective: "Publish",
    audience: "Owners",
    offer: "Guide",
    channels: ["x"],
    primaryMetric: "Reads",
    approvalPolicy: "each_item",
  });
  workflows.updateWorkflow(campaign.id, { status: "active", autopilot: true, autopilotPublish: true });
  attachWorkflowAccount(campaign.id, connection.id);
  const item = workflows.createContentItem({
    workflowId: campaign.id,
    title: "Auto post",
    body,
    format: "social_post",
    channel: "x",
  });
  workflows.updateContentItem(item.id, { status: "scheduled", scheduledFor: new Date(Date.now() - 1_000).toISOString() });
  return { workflows, connection, campaign, item };
}

describe("trusted autopilot publishing", () => {
  it("refuses without the stored policy, leaving nothing attempted", async () => {
    const { workflows, item } = await fixture();
    const { autoPublishContent } = await import("./publicationService.js");
    const fetchMock = mockXFetch(200, JSON.stringify({ data: { id: "1" } }));
    workflows.updateWorkflow(item.workflowId, { autopilotPublish: false });
    const outcome = await autoPublishContent(workflows.getContentItem(item.id)!);
    expect(outcome.published).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workflows.getContentItem(item.id)?.status).toBe("scheduled");
  });

  it("publishes due content through the same guards and ledger as the approval path", async () => {
    const { workflows, item } = await fixture();
    const { autoPublishContent } = await import("./publicationService.js");
    const { hasSuccessfulActionForSession } = await import("../platforms/spendGuard.js");
    const fetchMock = mockXFetch(200, JSON.stringify({ data: { id: "post-1" } }));
    const outcome = await autoPublishContent(workflows.getContentItem(item.id)!);
    expect(outcome).toMatchObject({ published: true, tripped: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.com/2/tweets");
    expect(init.headers.Authorization).toMatch(/^OAuth /);
    expect(JSON.parse(init.body)).toMatchObject({ text: "Autopilot posts exactly this reviewed text." });
    expect(workflows.getContentItem(item.id)?.status).toBe("published");
    // Policy survives success: one good post must not disarm the workflow.
    expect(workflows.getWorkflow(item.workflowId)?.autopilotPublish).toBe(true);
    const runs = workflows.listContentPublicationRuns(item.workflowId);
    expect(runs[0]).toMatchObject({ status: "published" });
    expect(hasSuccessfulActionForSession(runs[0].sessionId, "x")).toBe(true);
  });

  it("trips the policy off when X reports depleted credits", async () => {
    const { workflows, item } = await fixture();
    const { autoPublishContent } = await import("./publicationService.js");
    const { listNotifications } = await import("../notifications/notifier.js");
    mockXFetch(402, "credits depleted");
    const outcome = await autoPublishContent(workflows.getContentItem(item.id)!);
    expect(outcome).toMatchObject({ published: false, tripped: true });
    expect(workflows.getContentItem(item.id)?.status).toBe("scheduled");
    expect(workflows.getWorkflow(item.workflowId)?.autopilotPublish).toBe(false);
    const runs = workflows.listContentPublicationRuns(item.workflowId);
    expect(runs[0]?.status).toBe("failed");
  });

  it("treats a duplicate as permanently unpublishable and trips the policy", async () => {
    const { workflows, campaign, item } = await fixture("A text posted twice on purpose.");
    const { autoPublishContent } = await import("./publicationService.js");
    mockXFetch(200, JSON.stringify({ data: { id: "post-2" } }));
    const first = await autoPublishContent(workflows.getContentItem(item.id)!);
    expect(first.published).toBe(true);
    // A second item with the same text: X would bill the attempt, so it must
    // never be tried. (Retrying the same item would only exercise the
    // already-published guard, not the duplicate detector.)
    const fetchMock = mockXFetch(200, JSON.stringify({ data: { id: "post-3" } }));
    const twin = workflows.createContentItem({
      workflowId: campaign.id,
      title: "Same text again",
      body: "A text posted twice on purpose.",
      format: "social_post",
      channel: "x",
    });
    workflows.updateContentItem(twin.id, { status: "scheduled", scheduledFor: new Date(Date.now() - 1_000).toISOString() });
    const retry = await autoPublishContent(workflows.getContentItem(twin.id)!);
    expect(retry.published).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workflows.getWorkflow(item.workflowId)?.autopilotPublish).toBe(false);
  });

  it("keeps the policy on when only the daily cap is exhausted", async () => {
    const { workflows, connection, campaign } = await fixture();
    const { setConnectionCap } = await import("../db/connectionsRepo.js");
    const { autoPublishContent } = await import("./publicationService.js");
    setConnectionCap(connection.id, 1);
    const fetchMock = mockXFetch(200, JSON.stringify({ data: { id: "post-4" } }));
    // First post consumes the single daily slot...
    const item = workflows.createContentItem({
      workflowId: campaign.id,
      title: "First",
      body: "First post of the capped day.",
      format: "social_post",
      channel: "x",
    });
    workflows.updateContentItem(item.id, { status: "scheduled", scheduledFor: new Date(Date.now() - 1_000).toISOString() });
    expect((await autoPublishContent(workflows.getContentItem(item.id)!)).published).toBe(true);
    // ...the second waits for tomorrow instead of tripping the policy.
    const item2 = workflows.createContentItem({
      workflowId: campaign.id,
      title: "Second",
      body: "Second post of the capped day.",
      format: "social_post",
      channel: "x",
    });
    workflows.updateContentItem(item2.id, { status: "scheduled", scheduledFor: new Date(Date.now() - 1_000).toISOString() });
    const outcome = await autoPublishContent(workflows.getContentItem(item2.id)!);
    expect(outcome).toMatchObject({ published: false, tripped: false });
    expect(workflows.getWorkflow(campaign.id)?.autopilotPublish).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the approval path's tool behavior unchanged", async () => {
    await fixture();
    const { sendXPost } = await import("../platforms/actions.js");
    const fetchMock = mockXFetch(200, JSON.stringify({ data: { id: "post-5" } }));
    const outcome = await sendXPost(X_CREDS, undefined, { text: "Tool path intact." }, null);
    expect(outcome).toMatchObject({ ok: true, externalPostId: "post-5" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
