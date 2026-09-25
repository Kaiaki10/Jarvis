import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-autopause-"));
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
  accountId: "account",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function connectedX() {
  const { saveConnection, recordTestResult } = await import("../db/connectionsRepo.js");
  const connection = saveConnection("x_ads", X_CREDS, { forceNew: true });
  recordTestResult(connection.id, true, null, null);
  return connection;
}

async function bleedingCampaign() {
  const { createPaidGrowthCampaign, updatePaidGrowthCampaign } =
    await import("../db/paidGrowthRepo.js");
  const campaign = createPaidGrowthCampaign({
    name: "Bleeder", objective: "Leads", platform: "x_ads", currency: "USD",
    dailyBudgetMinor: 5_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01",
  });
  updatePaidGrowthCampaign(campaign.id, {
    status: "active", approvedBudgetMinor: 10_000, externalCampaignId: "abc123",
  });
  const { getPaidGrowthCampaign } = await import("../db/paidGrowthRepo.js");
  return getPaidGrowthCampaign(campaign.id)!;
}

describe("automatic loss-cutting", () => {
  it("applies a pause for a live campaign with an approved budget", async () => {
    await connectedX();
    const campaign = await bleedingCampaign();
    const { createPaidGrowthDecision, getPaidGrowthDecision, getPaidGrowthCampaign } =
      await import("../db/paidGrowthRepo.js");
    const { applyPauseDecision } = await import("./service.js");
    const decision = createPaidGrowthDecision({
      paidCampaignId: campaign.id, kind: "pause", reason: "Budget fully used.",
    });
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "abc123" } }));
    vi.stubGlobal("fetch", fetchMock);

    const applied = await applyPauseDecision(decision.id);
    expect(applied.status).toBe("applied");
    expect(getPaidGrowthCampaign(campaign.id)?.status).toBe("paused");
    expect(getPaidGrowthDecision(decision.id)?.status).toBe("applied");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("entity_status=PAUSED");
  });

  it("refuses to auto-pause a campaign nobody approved into existence", async () => {
    await connectedX();
    const { createPaidGrowthCampaign, updatePaidGrowthCampaign } = await import("../db/paidGrowthRepo.js");
    const { createPaidGrowthDecision, getPaidGrowthDecision } = await import("../db/paidGrowthRepo.js");
    const { applyPauseDecision } = await import("./service.js");
    const campaign = createPaidGrowthCampaign({
      name: "Unapproved", objective: "Leads", platform: "x_ads", currency: "USD",
      dailyBudgetMinor: 5_000, lifetimeBudgetMinor: 10_000, startDate: "2026-08-01",
    });
    updatePaidGrowthCampaign(campaign.id, { status: "active", externalCampaignId: "abc123" });
    const decision = createPaidGrowthDecision({
      paidCampaignId: campaign.id, kind: "pause", reason: "Budget fully used.",
    });
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "abc123" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(applyPauseDecision(decision.id)).rejects.toThrow(/approved budget/i);
    expect(getPaidGrowthDecision(decision.id)?.status).toBe("proposed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses non-pause kinds and already-reviewed decisions", async () => {
    await connectedX();
    const campaign = await bleedingCampaign();
    const { createPaidGrowthDecision } = await import("../db/paidGrowthRepo.js");
    const { applyPauseDecision } = await import("./service.js");
    const other = createPaidGrowthDecision({
      paidCampaignId: campaign.id, kind: "increase_budget", reason: "Doing well.",
      proposedDailyBudgetMinor: 6_000,
    });
    await expect(applyPauseDecision(other.id)).rejects.toThrow(/only pause/i);
    const pause = createPaidGrowthDecision({
      paidCampaignId: campaign.id, kind: "pause", reason: "Budget fully used.",
    });
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "abc123" } }));
    vi.stubGlobal("fetch", fetchMock);
    await applyPauseDecision(pause.id);
    await expect(applyPauseDecision(pause.id)).rejects.toThrow(/already been reviewed/i);
  });

  it("leaves the human approval path working exactly as before", async () => {
    await connectedX();
    const campaign = await bleedingCampaign();
    const { createPaidGrowthDecision, getPaidGrowthCampaign } = await import("../db/paidGrowthRepo.js");
    const { decidePaidGrowthRecommendation } = await import("./service.js");
    const decision = createPaidGrowthDecision({
      paidCampaignId: campaign.id, kind: "pause", reason: "Budget fully used.",
    });
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "abc123" } }));
    vi.stubGlobal("fetch", fetchMock);
    const applied = await decidePaidGrowthRecommendation(decision.id, "approve");
    expect(applied.status).toBe("applied");
    expect(getPaidGrowthCampaign(campaign.id)?.status).toBe("paused");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pauses a bleeding campaign on the monitor tick and says so loudly", async () => {
    await connectedX();
    const { updateSettings } = await import("../db/repo.js");
    updateSettings({ automationsEnabled: true });
    const campaign = await bleedingCampaign();
    // Force the bleed through the sync path rather than the stored totals:
    // the stats report lifetime spend past the lifetime budget.
    const statsBody = {
      data: [{
        id_data: [{
          metrics: {
            billed_charge_local_micro: [50_000_000, 60_000_000],
            impressions: [1_000],
            clicks: [50],
          },
        }],
      }],
    };
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/stats/")) return response(statsBody);
      return response({ data: { id: "abc123" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tickPaidGrowthMonitor } = await import("./monitor.js");
    const { getPaidGrowthCampaign, listPaidGrowthDecisions } = await import("../db/paidGrowthRepo.js");
    const { listNotifications } = await import("../notifications/notifier.js");

    expect(await tickPaidGrowthMonitor()).toBe(true);
    expect(getPaidGrowthCampaign(campaign.id)?.status).toBe("paused");
    const pause = listPaidGrowthDecisions().find(
      (d) => d.paidCampaignId === campaign.id && d.kind === "pause"
    );
    expect(pause?.status).toBe("applied");
    const alert = listNotifications().find((n) => n.title === "Campaign paused automatically");
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe("warning");
  });
});
