import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.JARVIS_DB_PATH = join(mkdtempSync(join(tmpdir(), "jarvis-facts-")), "test.db");
});

describe("measurementFactsRepo", () => {
  it("writes one row per metric and appends rather than overwrites on a second sync", async () => {
    const { createPaidGrowthCampaign } = await import("./paidGrowthRepo.js");
    const { recordMeasurementFacts, listMeasurementFacts } = await import("./measurementFactsRepo.js");

    const campaign = createPaidGrowthCampaign({
      name: "Facts campaign", objective: "Leads", platform: "google_ads", currency: "USD",
      dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01",
    });

    recordMeasurementFacts({
      paidCampaignId: campaign.id, workflowId: null, currency: "USD", capturedAt: "2026-08-01T00:00:00.000Z",
      spentMinor: 100, revenueMinor: 300, impressions: 1_000, clicks: 50, conversions: 2,
    });
    const afterFirst = listMeasurementFacts(campaign.id);
    expect(afterFirst).toHaveLength(5);
    expect(afterFirst.every((fact) => fact.source === "paid_ads")).toBe(true);

    recordMeasurementFacts({
      paidCampaignId: campaign.id, workflowId: null, currency: "USD", capturedAt: "2026-08-02T00:00:00.000Z",
      spentMinor: 200, revenueMinor: 700, impressions: 2_000, clicks: 90, conversions: 5,
    });
    const afterSecond = listMeasurementFacts(campaign.id);
    // Appended, not overwritten -- the first sync's rows are still there.
    expect(afterSecond).toHaveLength(10);
    expect(afterSecond.filter((fact) => fact.capturedAt === "2026-08-01T00:00:00.000Z")).toHaveLength(5);
    expect(afterSecond.filter((fact) => fact.capturedAt === "2026-08-02T00:00:00.000Z")).toHaveLength(5);

    const revenueOnly = listMeasurementFacts(campaign.id, "revenue_minor");
    expect(revenueOnly.map((fact) => fact.value).sort()).toEqual([300, 700]);
  });
});
