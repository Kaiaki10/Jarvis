import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.JARVIS_DB_PATH = join(mkdtempSync(join(tmpdir(), "jarvis-experiments-")), "test.db");
});

describe("campaignExperimentsRepo", () => {
  it("persists variants and lets a per-campaign lookup find them", async () => {
    const { createPaidGrowthCampaign } = await import("./paidGrowthRepo.js");
    const {
      createCampaignExperiment, listExperimentVariantCampaignIds, hasRunningExperimentForCampaign,
      concludeCampaignExperiment, getCampaignExperiment,
    } = await import("./campaignExperimentsRepo.js");

    const a = createPaidGrowthCampaign({ name: "A", objective: "Leads", platform: "google_ads", currency: "USD", dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01" });
    const b = createPaidGrowthCampaign({ name: "B", objective: "Leads", platform: "meta_ads", currency: "USD", dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01" });

    const experiment = createCampaignExperiment({
      name: "A vs B", hypothesis: "B converts better",
      variantPaidCampaignIds: [a.id, b.id], controlPaidCampaignId: a.id,
    });

    expect(experiment.status).toBe("running");
    expect(new Set(listExperimentVariantCampaignIds(experiment.id))).toEqual(new Set([a.id, b.id]));
    expect(hasRunningExperimentForCampaign(a.id)).toBe(true);
    expect(hasRunningExperimentForCampaign(b.id)).toBe(true);

    const concluded = concludeCampaignExperiment(experiment.id, {
      status: "concluded", winnerPaidCampaignId: b.id, conclusionNote: "B won on ROAS",
    });
    expect(concluded?.status).toBe("concluded");
    expect(concluded?.winnerPaidCampaignId).toBe(b.id);
    // Concluding frees the campaigns to join a new experiment.
    expect(hasRunningExperimentForCampaign(a.id)).toBe(false);
    // A second conclude call is a no-op (already-concluded guard).
    expect(concludeCampaignExperiment(experiment.id, { status: "abandoned", conclusionNote: "n/a" })).toBeUndefined();
    expect(getCampaignExperiment(experiment.id)?.status).toBe("concluded");
  });

  it("respects agent scoping through its variants' owning campaigns", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createPaidGrowthCampaign } = await import("./paidGrowthRepo.js");
    const { createCampaignExperiment, listCampaignExperiments } = await import("./campaignExperimentsRepo.js");

    const alice = createAgent({ name: "Alice Experiments" });
    const bob = createAgent({ name: "Bob Experiments" });

    const aliceA = createPaidGrowthCampaign({ name: "Alice A", objective: "Leads", platform: "google_ads", currency: "USD", dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01", agentId: alice.id });
    const aliceB = createPaidGrowthCampaign({ name: "Alice B", objective: "Leads", platform: "meta_ads", currency: "USD", dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01", agentId: alice.id });
    const bobA = createPaidGrowthCampaign({ name: "Bob A", objective: "Leads", platform: "google_ads", currency: "USD", dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01", agentId: bob.id });
    const bobB = createPaidGrowthCampaign({ name: "Bob B", objective: "Leads", platform: "meta_ads", currency: "USD", dailyBudgetMinor: 1_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01", agentId: bob.id });

    createCampaignExperiment({ name: "Alice's experiment", hypothesis: "x", variantPaidCampaignIds: [aliceA.id, aliceB.id] });
    createCampaignExperiment({ name: "Bob's experiment", hypothesis: "y", variantPaidCampaignIds: [bobA.id, bobB.id] });

    expect(listCampaignExperiments(alice.id).map((experiment) => experiment.name)).toEqual(["Alice's experiment"]);
    expect(listCampaignExperiments(bob.id).map((experiment) => experiment.name)).toEqual(["Bob's experiment"]);
    expect(listCampaignExperiments().length).toBeGreaterThanOrEqual(2);
  });
});
