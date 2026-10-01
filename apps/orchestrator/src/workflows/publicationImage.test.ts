import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-pubimage-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
  process.env.JARVIS_KEY_PATH = join(dir, "test.key");
  const folder = join(dir, "images");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "hero.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  const { updateSettings } = await import("../db/repo.js");
  updateSettings({ imagesFolder: folder });
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

async function fixture(imageFile: string | null) {
  const workflows = await import("../db/workflowRepo.js");
  const { saveConnection, recordTestResult } = await import("../db/connectionsRepo.js");
  const { attachWorkflowAccount } = await import("../db/workflowAccountsRepo.js");
  const connection = saveConnection("x", X_CREDS, { forceNew: true });
  recordTestResult(connection.id, true, null, null);
  const campaign = workflows.createWorkflow({
    name: `Visual ${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
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
    title: "Visual post",
    body: "A post with a visual.",
    format: "social_post",
    channel: "x",
    imageFile,
  });
  workflows.updateContentItem(item.id, { status: "scheduled", scheduledFor: new Date(Date.now() - 1_000).toISOString() });
  return { workflows, item };
}

describe("image-aware publishing", () => {
  it("refuses readiness when the attached file is gone", async () => {
    const { item } = await fixture("missing.png");
    const { contentPublishingReadiness } = await import("./publicationService.js");
    const { getContentItem } = await import("../db/workflowRepo.js");
    const readiness = contentPublishingReadiness(getContentItem(item.id)!);
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toContain("missing.png");
  });

  it("passes readiness when the attached file exists", async () => {
    const { item } = await fixture("hero.png");
    const { contentPublishingReadiness } = await import("./publicationService.js");
    const { getContentItem } = await import("../db/workflowRepo.js");
    const readiness = contentPublishingReadiness(getContentItem(item.id)!);
    expect(readiness.ready).toBe(true);
  });

  it("instructs the manual run to attach the image, and only then", async () => {
    const { publicationPrompt } = await import("./publicationService.js");
    const { getContentItem } = await import("../db/workflowRepo.js");
    const withImage = getContentItem((await fixture("hero.png")).item.id)!;
    expect(publicationPrompt(withImage)).toContain('attach "hero.png" via the imageFile argument');
    const textOnly = getContentItem((await fixture(null)).item.id)!;
    expect(publicationPrompt(textOnly)).toContain("Do not attach an image.");
  });

  it("autopilot skips visual items without tripping the policy or calling X", async () => {
    const { workflows, item } = await fixture("hero.png");
    const { autoPublishContent } = await import("./publicationService.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("{}") });
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await autoPublishContent(workflows.getContentItem(item.id)!);
    expect(outcome).toMatchObject({ published: false, tripped: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workflows.getContentItem(item.id)?.status).toBe("scheduled");
    expect(workflows.getWorkflow(item.workflowId)?.autopilotPublish).toBe(true);
  });
});
