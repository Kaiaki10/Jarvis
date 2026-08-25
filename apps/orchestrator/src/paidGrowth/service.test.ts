import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.JARVIS_DB_PATH = join(mkdtempSync(join(tmpdir(), "jarvis-manual-perf-")), "test.db");
});

describe("recordManualPerformance", () => {
  it("feeds the measurement ledger, not just the campaign's cumulative totals", async () => {
    // Found live: the manual performance-entry path (the only one testable
    // without real ad-platform credentials) never wrote to measurement_facts,
    // so a campaign entered by hand never accumulated any history. Regression
    // test for that fix.
    const { createPaidGrowthCampaign, getPaidGrowthCampaign } = await import("../db/paidGrowthRepo.js");
    const { listMeasurementFacts } = await import("../db/measurementFactsRepo.js");
    const { recordManualPerformance } = await import("./service.js");

    const campaign = createPaidGrowthCampaign({
      name: "Manual entry campaign", objective: "Leads", platform: "google_ads", currency: "USD",
      dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01",
    });

    const updated = recordManualPerformance(campaign.id, {
      spentMinor: 500, revenueMinor: 1_500, impressions: 5_000, clicks: 200, conversions: 4,
    });

    expect(updated.spentMinor).toBe(500);
    expect(getPaidGrowthCampaign(campaign.id)?.revenueMinor).toBe(1_500);

    const facts = listMeasurementFacts(campaign.id);
    expect(facts).toHaveLength(5);
    expect(facts.find((fact) => fact.metric === "revenue_minor")?.value).toBe(1_500);
    expect(facts.find((fact) => fact.metric === "conversions")?.value).toBe(4);
  });
});
