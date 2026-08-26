import { afterEach, describe, expect, it, vi } from "vitest";

const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Everything under test reads module-level state (activeAgentId, token caches), so each test gets a fresh module instance. */
async function freshApi() {
  vi.resetModules();
  return import("./api");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.ts token scoping", () => {
  it("mints and sends a per-agent token for a scoped call", async () => {
    const { api, setActiveAgentId } = await freshApi();
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) => {
        if (url.startsWith("/api/token?agentId=agent-a")) return Promise.resolve(jsonResponse({ token: "agent-a-token", expiresAt: FUTURE }));
        if (url.includes("/sessions")) return Promise.resolve(jsonResponse([]));
        throw new Error(`unexpected fetch: ${url}`);
      });
    vi.stubGlobal("fetch", fetchMock);

    setActiveAgentId("agent-a");
    await api.listSessions();

    const tokenCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith("/api/token"));
    expect(tokenCall?.[0]).toBe("/api/token?agentId=agent-a");

    const orchestratorCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/sessions"));
    expect(orchestratorCall?.[0]).toContain("agentId=agent-a");
    expect((orchestratorCall?.[1] as RequestInit)?.headers).toMatchObject({ Authorization: "Bearer agent-a-token" });
  });

  it("uses the master token for an unscoped call", async () => {
    const { api } = await freshApi();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/token") return Promise.resolve(jsonResponse({ token: "master-token" }));
      if (url.includes("/agents")) return Promise.resolve(jsonResponse([]));
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.listAgents();

    const tokenCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith("/api/token"));
    expect(tokenCall?.[0]).toBe("/api/token");
    const orchestratorCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/agents"));
    expect((orchestratorCall?.[1] as RequestInit)?.headers).toMatchObject({ Authorization: "Bearer master-token" });
  });

  it("re-mints exactly once and retries on a 403 from a scoped call", async () => {
    const { api, setActiveAgentId } = await freshApi();
    let mintCount = 0;
    let sessionCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).startsWith("/api/token?agentId=agent-a")) {
        mintCount += 1;
        return Promise.resolve(jsonResponse({ token: `agent-a-token-${mintCount}`, expiresAt: FUTURE }));
      }
      if (String(url).includes("/sessions")) {
        sessionCallCount += 1;
        // First call's token is treated as stale by the orchestrator; the retry succeeds.
        return Promise.resolve(sessionCallCount === 1 ? jsonResponse({ error: "stale" }, 403) : jsonResponse([]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    setActiveAgentId("agent-a");
    const result = await api.listSessions();

    expect(result).toEqual([]);
    expect(mintCount).toBe(2); // initial mint + one re-mint after the 403
    expect(sessionCallCount).toBe(2); // initial attempt + one retry
  });

  it("does not retry an unscoped call on failure", async () => {
    const { api } = await freshApi();
    let agentsCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/token") return Promise.resolve(jsonResponse({ token: "master-token" }));
      if (String(url).includes("/agents")) {
        agentsCallCount += 1;
        return Promise.resolve(jsonResponse({ error: "nope" }, 403));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listAgents()).rejects.toThrow("nope");
    expect(agentsCallCount).toBe(1);
  });
});
