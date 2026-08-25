import { describe, expect, it } from "vitest";
import type { PaidGrowthCampaignRecord } from "@jarvis/shared";
import { paidGrowthMetrics, recommendPaidGrowthActions } from "./engine.js";

function campaign(patch: Partial<PaidGrowthCampaignRecord> = {}): PaidGrowthCampaignRecord {
  return {
    id: "a",
    workflowId: null,
    name: "Growth",
    objective: "Acquire customers",
    platform: "google_ads",
    externalCampaignId: null,
    status: "active",
    currency: "USD",
    dailyBudgetMinor: 1_000,
    lifetimeBudgetMinor: 10_000,
    approvedBudgetMinor: 10_000,
    spentMinor: 2_000,
    revenueMinor: 6_000,
    impressions: 10_000,
    clicks: 500,
    conversions: 10,
    targetRoas: 2,
    startDate: "2026-08-01",
    endDate: null,
    lastSyncedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  };
}

describe("paid growth engine", () => {
  it("computes performance without divide-by-zero artifacts", () => {
    expect(paidGrowthMetrics(campaign()).roas).toBe(3);
    expect(paidGrowthMetrics(campaign({ spentMinor: 0, clicks: 0, conversions: 0 })).cpcMinor).toBeNull();
  });

  it("recommends a bounded increase for proven winners", () => {
    const actions = recommendPaidGrowthActions([campaign()]);
    expect(actions).toContainEqual(expect.objectContaining({ kind: "increase_budget", proposedDailyBudgetMinor: 1_200 }));
  });

  it("recommends pausing material underperformance", () => {
    const actions = recommendPaidGrowthActions([campaign({ revenueMinor: 1_000 })]);
    expect(actions).toContainEqual(expect.objectContaining({ kind: "pause" }));
  });

  it("never recommends automatic decisions for drafts", () => {
    expect(recommendPaidGrowthActions([campaign({ status: "draft" })])).toEqual([]);
  });

  it("no longer proposes reallocation between unrelated campaigns on its own", () => {
    // This used to rank every active campaign globally and propose moving
    // budget from the worst to the best ROAS with no declared comparison.
    // That's now `experimentEngine.ts`'s job, gated behind a deliberately
    // declared experiment -- see GAPS.md's attribution gap.
    const actions = recommendPaidGrowthActions([
      campaign({ id: "a", name: "Strong", spentMinor: 1_000, revenueMinor: 5_000, conversions: 10 }),
      campaign({ id: "b", name: "Weak", spentMinor: 1_000, revenueMinor: 500, conversions: 10 }),
    ]);
    expect(actions.some((action) => action.kind === "reallocate")).toBe(false);
  });
});
