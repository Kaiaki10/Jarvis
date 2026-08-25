import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-experiment-service-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
  process.env.JARVIS_KEY_PATH = join(dir, "test.key");
});

// decidePaidGrowthRecommendation's platform mutation is a real network call.
// This test is about the decision/capacity plumbing around it, not the
// platform-specific request shapes -- those are covered by executor.test.ts.
vi.mock("./executor.js", () => ({ executePaidGrowthAction: vi.fn().mockResolvedValue(undefined) }));

async function setUpConnectedCampaign(name: string) {
  const { createPaidGrowthCampaign } = await import("../db/paidGrowthRepo.js");
  const { saveConnection, recordTestResult, getConnection } = await import("../db/connectionsRepo.js");
  const connection = getConnection("google_ads") ?? saveConnection("google_ads", { clientId: "x" });
  if (connection.status !== "connected") recordTestResult(connection.id, true, "ok", null);
  return createPaidGrowthCampaign({
    name, objective: "Leads", platform: "google_ads", currency: "USD",
    dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 100_000, externalCampaignId: "123456", startDate: "2026-08-01",
  });
}

/** Backdates an experiment's start so the days-running threshold is already met. */
async function backdateExperiment(experimentId: string, daysAgo: number) {
  const { db } = await import("../db/db.js");
  const startedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE campaign_experiments SET started_at = ? WHERE id = ?`).run(startedAt, experimentId);
}

describe("experimentService", () => {
  it("refuses to conclude an experiment before its thresholds are met", async () => {
    const winner = await setUpConnectedCampaign("Not ready winner");
    const loser = await setUpConnectedCampaign("Not ready loser");
    const { createExperiment, concludeExperiment } = await import("./experimentService.js");
    const experiment = createExperiment({
      name: "Too soon", hypothesis: "x", variantPaidCampaignIds: [winner.id, loser.id],
    });
    expect(() => concludeExperiment(experiment.id)).toThrow(/day/);
  });

  it("concludes with a winner, proposes exactly one reallocate decision, and that decision executes", async () => {
    const { setEnvelope } = await import("../billing/envelopes.js");
    setEnvelope({ rail: "ad_budget", period: "day", limitMinor: 1_000_000, currency: "USD" });

    const winner = await setUpConnectedCampaign("Decisive winner");
    const loser = await setUpConnectedCampaign("Decisive loser");
    const { updatePaidGrowthPerformance } = await import("../db/paidGrowthRepo.js");
    updatePaidGrowthPerformance(winner.id, { spentMinor: 1_000, revenueMinor: 5_000, impressions: 10_000, clicks: 500, conversions: 10 });
    updatePaidGrowthPerformance(loser.id, { spentMinor: 1_000, revenueMinor: 500, impressions: 10_000, clicks: 500, conversions: 10 });

    const { createExperiment, concludeExperiment } = await import("./experimentService.js");
    const experiment = createExperiment({
      name: "Decisive", hypothesis: "one clearly outperforms",
      variantPaidCampaignIds: [winner.id, loser.id], minConversionsPerVariant: 2, minDaysRunning: 1,
    });
    await backdateExperiment(experiment.id, 10);

    const { experiment: concluded, decision } = concludeExperiment(experiment.id);
    expect(concluded.status).toBe("concluded");
    expect(concluded.winnerPaidCampaignId).toBe(winner.id);
    expect(decision).not.toBeNull();
    expect(decision!.kind).toBe("reallocate");
    expect(decision!.experimentId).toBe(experiment.id);
    expect(decision!.paidCampaignId).toBe(winner.id);
    expect(decision!.sourcePaidCampaignId).toBe(loser.id);

    // Only one decision was created -- concluding again is refused outright.
    expect(() => concludeExperiment(experiment.id)).toThrow();

    const { decidePaidGrowthRecommendation } = await import("./service.js");
    const applied = await decidePaidGrowthRecommendation(decision!.id, "approve");
    expect(applied.status).toBe("applied");

    const { getPaidGrowthCampaign } = await import("../db/paidGrowthRepo.js");
    expect(getPaidGrowthCampaign(winner.id)!.dailyBudgetMinor).toBe(1_200); // +20%
    expect(getPaidGrowthCampaign(loser.id)!.dailyBudgetMinor).toBe(800); // -20%
  });

  it("concludes with no decision when the experiment is inconclusive", async () => {
    const { setEnvelope } = await import("../billing/envelopes.js");
    setEnvelope({ rail: "ad_budget", period: "day", limitMinor: 1_000_000, currency: "USD" });

    const a = await setUpConnectedCampaign("Close A");
    const b = await setUpConnectedCampaign("Close B");
    const { updatePaidGrowthPerformance } = await import("../db/paidGrowthRepo.js");
    updatePaidGrowthPerformance(a.id, { spentMinor: 1_000, revenueMinor: 2_000, impressions: 10_000, clicks: 500, conversions: 10 });
    updatePaidGrowthPerformance(b.id, { spentMinor: 1_000, revenueMinor: 1_800, impressions: 10_000, clicks: 500, conversions: 10 });

    const { createExperiment, concludeExperiment } = await import("./experimentService.js");
    const experiment = createExperiment({
      name: "Close call", hypothesis: "probably a wash",
      variantPaidCampaignIds: [a.id, b.id], minConversionsPerVariant: 2, minDaysRunning: 1,
    });
    await backdateExperiment(experiment.id, 10);

    const { experiment: concluded, decision } = concludeExperiment(experiment.id);
    expect(concluded.status).toBe("concluded");
    expect(concluded.winnerPaidCampaignId).toBeNull();
    expect(decision).toBeNull();
  });
});
