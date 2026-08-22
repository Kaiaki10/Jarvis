import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaidGrowthCampaignRecord } from "@jarvis/shared";
import { executePaidGrowthActionWithCredentials } from "./executor.js";

function campaign(platform: PaidGrowthCampaignRecord["platform"], patch: Partial<PaidGrowthCampaignRecord> = {}): PaidGrowthCampaignRecord {
  return {
    id: "paid-1", workflowId: null, name: "Growth", objective: "Acquire customers", platform,
    externalCampaignId: platform === "x_ads" ? "abc123" : "123456", externalBudgetEntityId: null,
    status: "approved", currency: "USD", dailyBudgetMinor: 2_500, lifetimeBudgetMinor: 50_000,
    approvedBudgetMinor: 50_000, spentMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0,
    conversions: 0, targetRoas: 2, startDate: "2026-08-18", endDate: null, lastSyncedAt: null,
    createdAt: "2026-08-18T00:00:00Z", updatedAt: "2026-08-18T00:00:00Z", ...patch,
  };
}

function response(body: unknown = { results: [{}] }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("paid growth platform execution", () => {
  it("updates a dedicated Google budget before enabling the campaign", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access" }))
      .mockResolvedValueOnce(response({ results: [{ campaignBudget: { resourceName: "customers/1/campaignBudgets/9", explicitlyShared: false } }] }))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetchMock);
    await executePaidGrowthActionWithCredentials(campaign("google_ads"), { dailyBudgetMinor: 2_500, status: "active" }, {
      clientId: "client", clientSecret: "secret", refreshToken: "refresh", developerToken: "developer", customerId: "111-222-3333",
    });
    expect(fetchMock.mock.calls[2][0]).toContain("/campaignBudgets:mutate");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ operations: [{ update: { amountMicros: "25000000" } }] });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toMatchObject({ operations: [{ update: { status: "ENABLED" } }] });
  });

  it("refuses to mutate a shared Google budget", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access" }))
      .mockResolvedValueOnce(response({ results: [{ campaignBudget: { resourceName: "customers/1/campaignBudgets/9", explicitlyShared: true } }] })));
    await expect(executePaidGrowthActionWithCredentials(campaign("google_ads"), { dailyBudgetMinor: 2_500 }, {
      clientId: "client", clientSecret: "secret", refreshToken: "refresh", developerToken: "developer", customerId: "1112223333",
    })).rejects.toThrow("shared budget");
  });

  it("uses the configured Meta budget owner and campaign status separately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    await executePaidGrowthActionWithCredentials(campaign("meta_ads", { externalBudgetEntityId: "789" }), { dailyBudgetMinor: 3_000, status: "paused" }, { accessToken: "token" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v24.0/789");
    expect(fetchMock.mock.calls[0][1].body).toBe("daily_budget=3000");
    expect(fetchMock.mock.calls[1][0]).toBe("https://graph.facebook.com/v24.0/123456");
    expect(fetchMock.mock.calls[1][1].body).toBe("status=PAUSED");
  });

  it("applies X budget and status in one signed mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "abc123" } }));
    vi.stubGlobal("fetch", fetchMock);
    await executePaidGrowthActionWithCredentials(campaign("x_ads"), { dailyBudgetMinor: 1_250, status: "active" }, {
      apiKey: "key", apiSecret: "secret", accessToken: "token", accessTokenSecret: "token-secret", accountId: "account",
    });
    expect(fetchMock.mock.calls[0][0]).toContain("daily_budget_amount_local_micro=12500000");
    expect(fetchMock.mock.calls[0][0]).toContain("entity_status=ACTIVE");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^OAuth /);
  });
});
