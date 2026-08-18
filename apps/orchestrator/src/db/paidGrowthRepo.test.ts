import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-paid-growth-"));
  process.env.JARVIS_DB_PATH = join(directory, "paid-growth.db");
});

describe("paid growth repository", () => {
  it("keeps budgets and cumulative performance durable", async () => {
    const repo = await import("./paidGrowthRepo.js");
    const created = repo.createPaidGrowthCampaign({
      name: "Acquisition",
      objective: "Acquire qualified customers",
      platform: "google_ads",
      currency: "USD",
      dailyBudgetMinor: 2_500,
      lifetimeBudgetMinor: 50_000,
      targetRoas: 2.5,
      startDate: "2026-08-18",
    });
    repo.updatePaidGrowthPerformance(created.id, {
      spentMinor: 5_000,
      revenueMinor: 15_000,
      impressions: 20_000,
      clicks: 800,
      conversions: 20,
    });
    expect(repo.getPaidGrowthCampaign(created.id)).toMatchObject({
      spentMinor: 5_000,
      revenueMinor: 15_000,
      conversions: 20,
      lastSyncedAt: null,
    });
    repo.updatePaidGrowthPerformance(created.id, {
      spentMinor: 5_100,
      revenueMinor: 15_500,
      impressions: 20_500,
      clicks: 810,
      conversions: 21,
    }, true);
    expect(repo.getPaidGrowthCampaign(created.id)?.lastSyncedAt).not.toBeNull();
  });

  it("keeps material decisions auditable and one-time reviewable", async () => {
    const repo = await import("./paidGrowthRepo.js");
    const campaign = repo.listPaidGrowthCampaigns()[0];
    const decision = repo.createPaidGrowthDecision({
      paidCampaignId: campaign.id,
      kind: "increase_budget",
      reason: "ROAS is above target.",
      proposedDailyBudgetMinor: 3_000,
    });
    expect(repo.hasOpenPaidGrowthDecision(campaign.id, "increase_budget")).toBe(true);
    expect(repo.reviewPaidGrowthDecision(decision.id, "approved")?.status).toBe("approved");
    expect(repo.reviewPaidGrowthDecision(decision.id, "rejected")).toBeUndefined();
  });
});
