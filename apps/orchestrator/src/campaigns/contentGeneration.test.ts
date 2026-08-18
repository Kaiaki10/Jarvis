import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-campaigns-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
});

describe("campaign content generation", () => {
  it("parses the bounded tagged draft response", async () => {
    const { parseGeneratedDrafts } = await import("./contentGeneration.js");
    const result = `<jarvis-content-drafts>{"drafts":[{"title":"Launch","body":"Meet the new workflow.","format":"social_post","channel":"linkedin"}]}</jarvis-content-drafts>`;
    expect(parseGeneratedDrafts(result)).toEqual([
      { title: "Launch", body: "Meet the new workflow.", format: "social_post", channel: "linkedin" },
    ]);
  });

  it("treats the campaign brief as authoritative instead of exploring the project", async () => {
    const { campaignGenerationPrompt } = await import("./contentGeneration.js");
    const repo = await import("../db/campaignRepo.js");
    const campaign = repo.createCampaign({
      name: "Focused brief",
      objective: "Create demand",
      audience: "Owners",
      offer: "A walkthrough",
      channels: ["linkedin"],
      primaryMetric: "Requests",
      approvalPolicy: "each_item",
    });
    const prompt = campaignGenerationPrompt({ campaign, count: 1, formats: ["social_post"], channels: ["linkedin"] });
    expect(prompt).toContain("complete and authoritative");
    expect(prompt).toContain("Do not seek more context");
    expect(prompt).toContain("Return no commentary outside");
  });

  it("turns a successful generation run into durable drafts", async () => {
    const repo = await import("../db/campaignRepo.js");
    const sessionRepo = await import("../db/repo.js");
    const { reconcileCampaignGeneration } = await import("./contentGeneration.js");
    const campaign = repo.createCampaign({
      name: "Launch",
      objective: "Drive qualified demos",
      audience: "Operations leaders",
      offer: "A guided product demo",
      channels: ["linkedin"],
      primaryMetric: "Qualified demo requests",
      approvalPolicy: "each_item",
    });
    const session = sessionRepo.createSession({ title: "Generate", cwd: process.cwd(), permissionMode: "plan" });
    repo.createCampaignGenerationRun({ campaignId: campaign.id, sessionId: session.id, requestedCount: 1 });

    expect(reconcileCampaignGeneration({
      sessionId: session.id,
      ok: true,
      result: `<jarvis-content-drafts>{"drafts":[{"title":"A better handoff","body":"Replace the spreadsheet handoff.","format":"social_post","channel":"linkedin"}]}</jarvis-content-drafts>`,
    })).toBe(true);

    expect(repo.listContentItems(campaign.id)[0]).toMatchObject({ title: "A better handoff", status: "draft" });
    expect(repo.getCampaignGenerationRunBySession(session.id)?.status).toBe("completed");
  });

  it("fails closed when Jarvis targets an unapproved channel", async () => {
    const repo = await import("../db/campaignRepo.js");
    const sessionRepo = await import("../db/repo.js");
    const { reconcileCampaignGeneration } = await import("./contentGeneration.js");
    const campaign = repo.createCampaign({
      name: "Email nurture",
      objective: "Activate trials",
      audience: "Trial users",
      offer: "Onboarding help",
      channels: ["email"],
      primaryMetric: "Activations",
      approvalPolicy: "each_item",
    });
    const session = sessionRepo.createSession({ title: "Generate", cwd: process.cwd(), permissionMode: "plan" });
    repo.createCampaignGenerationRun({ campaignId: campaign.id, sessionId: session.id, requestedCount: 1 });
    reconcileCampaignGeneration({
      sessionId: session.id,
      ok: true,
      result: `<jarvis-content-drafts>{"drafts":[{"title":"Post","body":"Hello","format":"social_post","channel":"x"}]}</jarvis-content-drafts>`,
    });
    expect(repo.listContentItems(campaign.id)).toHaveLength(0);
    expect(repo.getCampaignGenerationRunBySession(session.id)).toMatchObject({ status: "failed" });
  });
});
