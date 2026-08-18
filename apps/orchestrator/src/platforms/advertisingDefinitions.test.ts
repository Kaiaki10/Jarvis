import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatform } from "./definitions.js";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("advertising platform connection probes", () => {
  it("refreshes Google OAuth and proves access to the configured customer", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access" }))
      .mockResolvedValueOnce(response({ results: [{ customer: { descriptiveName: "Acme", currencyCode: "USD" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await getPlatform("google_ads")!.test({
      developerToken: "developer",
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      customerId: "123-456-7890",
      loginCustomerId: "098-765-4321",
    });
    expect(result).toEqual({ ok: true, detail: "Connected to Acme (USD)" });
    expect(fetchMock.mock.calls[1][0]).toContain("/v25/customers/1234567890/googleAds:search");
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Authorization: "Bearer access",
      "developer-token": "developer",
      "login-customer-id": "0987654321",
    });
  });

  it("normalizes the Meta ad account prefix and reads account identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ name: "Acme Social", currency: "USD" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await getPlatform("meta_ads")!.test({ accessToken: "token", adAccountId: "act_12345" });
    expect(result).toEqual({ ok: true, detail: "Connected to Acme Social (USD)" });
    expect(fetchMock.mock.calls[0][0]).toContain("/v24.0/act_12345?fields=name,account_status,currency");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
  });

  it("signs the current X Ads account endpoint with OAuth 1", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { name: "Acme X" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await getPlatform("x_ads")!.test({
      apiKey: "key",
      apiSecret: "secret",
      accessToken: "token",
      accessTokenSecret: "token-secret",
      accountId: "abc123",
      fundingInstrumentId: "fund123",
    });
    expect(result).toEqual({ ok: true, detail: "Connected to Acme X" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://ads-api.x.com/12/accounts/abc123");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^OAuth /);
  });
});
