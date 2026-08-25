import { describe, expect, it } from "vitest";
import type { CampaignExperimentRecord, PaidGrowthCampaignRecord } from "@jarvis/shared";
import { evaluateExperiment } from "./experimentEngine.js";

function campaign(patch: Partial<PaidGrowthCampaignRecord> = {}): PaidGrowthCampaignRecord {
  return {
    id: "a", agentId: null, workflowId: null, name: "Variant A", objective: "Acquire customers",
    platform: "google_ads", externalCampaignId: null, externalBudgetEntityId: null, status: "active",
    currency: "USD", dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, approvedBudgetMinor: 10_000,
    spentMinor: 2_000, revenueMinor: 6_000, impressions: 10_000, clicks: 500, conversions: 10,
    targetRoas: 2, startDate: "2026-08-01", endDate: null, lastSyncedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...patch,
  };
}

function experiment(patch: Partial<CampaignExperimentRecord> = {}): CampaignExperimentRecord {
  return {
    id: "exp-1", name: "A/B", hypothesis: "B wins", status: "running",
    minConversionsPerVariant: 5, minDaysRunning: 7,
    startedAt: "2026-08-01T00:00:00.000Z", concludedAt: null, winnerPaidCampaignId: null,
    conclusionNote: null, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  };
}

const NOW = new Date("2026-08-10T00:00:00.000Z").getTime(); // 9 days after startedAt above

describe("evaluateExperiment", () => {
  it("is not ready before the minimum days have elapsed", () => {
    const result = evaluateExperiment(
      experiment({ minDaysRunning: 30 }),
      [campaign({ id: "a" }), campaign({ id: "b" })],
      NOW
    );
    expect(result.ready).toBe(false);
    expect(result.winnerPaidCampaignId).toBeNull();
  });

  it("is not ready when any single variant is short on conversions, even if others aren't", () => {
    const result = evaluateExperiment(
      experiment({ minConversionsPerVariant: 5 }),
      [campaign({ id: "a", conversions: 50 }), campaign({ id: "b", conversions: 1 })],
      NOW
    );
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("1 of 2 variants");
  });

  it("declares a winner once thresholds are met and ROAS is decisively ahead", () => {
    const result = evaluateExperiment(
      experiment(),
      [
        campaign({ id: "a", name: "Winner", spentMinor: 1_000, revenueMinor: 3_000, conversions: 10, dailyBudgetMinor: 1_000 }),
        campaign({ id: "b", name: "Loser", spentMinor: 1_000, revenueMinor: 500, conversions: 10 }),
      ],
      NOW
    );
    expect(result.ready).toBe(true);
    expect(result.winnerPaidCampaignId).toBe("a");
    expect(result.loserPaidCampaignId).toBe("b");
    expect(result.proposedDailyBudgetMinor).toBe(1_200);
  });

  it("is ready but declares no winner when ROAS is close", () => {
    const result = evaluateExperiment(
      experiment(),
      [
        campaign({ id: "a", spentMinor: 1_000, revenueMinor: 2_000, conversions: 10 }),
        campaign({ id: "b", spentMinor: 1_000, revenueMinor: 1_800, conversions: 10 }),
      ],
      NOW
    );
    expect(result.ready).toBe(true);
    expect(result.winnerPaidCampaignId).toBeNull();
    expect(result.proposedDailyBudgetMinor).toBeNull();
  });
});
