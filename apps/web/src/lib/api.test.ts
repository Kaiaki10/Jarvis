import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The token cache is module-level state, so each test gets a fresh module instance. */
async function freshApi() {
  vi.resetModules();
  return import("./api");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.ts auth", () => {
  it("sends the orchestrator token, fetched once, and never an agent scope", async () => {
    const { api } = await freshApi();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/token") return Promise.resolve(jsonResponse({ token: "master-token" }));
      if (url.includes("/sessions") || url.includes("/agent")) return Promise.resolve(jsonResponse([]));
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([api.listSessions(), api.getJarvis()]);

    const tokenCalls = fetchMock.mock.calls.filter((call) => String(call[0]).startsWith("/api/token"));
    expect(tokenCalls).toHaveLength(1);
    const orchestratorCalls = fetchMock.mock.calls.filter((call) => !String(call[0]).startsWith("/api/token"));
    for (const call of orchestratorCalls) {
      expect(String(call[0])).not.toContain("agentId=");
      expect((call[1] as RequestInit)?.headers).toMatchObject({ Authorization: "Bearer master-token" });
    }
  });

  it("surfaces the orchestrator's error message and does not retry", async () => {
    const { api } = await freshApi();
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/token") return Promise.resolve(jsonResponse({ token: "master-token" }));
      if (String(url).includes("/agent")) {
        calls += 1;
        return Promise.resolve(jsonResponse({ error: "nope" }, 403));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getJarvis()).rejects.toThrow("nope");
    expect(calls).toBe(1);
  });
});
