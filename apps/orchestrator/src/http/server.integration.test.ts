import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * The first real HTTP-layer integration test in this repo: boots the actual
 * Express app on an OS-assigned ephemeral port (never the live service's
 * :4317) and issues real requests against it. Nothing short of this actually
 * proves the auth middleware and `scopedAgentId`'s cross-check behave
 * correctly *together* -- `agentAuth.test.ts` covers the decision table in
 * isolation, but not that `server.ts` wires it up correctly.
 */
let baseUrl: string;
let masterToken: string;
let server: Server;
let agentA: { id: string };
let agentB: { id: string };

beforeAll(async () => {
  // Importing server.ts pulls in essentially the whole app's module graph
  // (scheduler, Slack bridge, evolution, paid growth, customers, ...) for the
  // first time -- transpiling and evaluating all of it comfortably exceeds
  // vitest's default 10s hook timeout on a cold run.
  const dir = mkdtempSync(join(tmpdir(), "jarvis-http-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
  process.env.JARVIS_TOKEN_PATH = join(dir, "test.token");
  process.env.PORT = "0";
  process.env.JARVIS_PASSIVE_FALLBACK = "1";

  const mod = await import("./server.js");
  server = mod.server;
  const { apiToken } = await import("../security/apiToken.js");
  const { createAgent } = await import("../db/agentRepo.js");

  masterToken = apiToken();
  agentA = createAgent({ name: "Agent A" });
  agentB = createAgent({ name: "Agent B" });

  // `app.listen(...)` binds asynchronously -- the module import settles once
  // it's *called*, not once the OS-level bind actually completes.
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(() => {
  // Not the module's own shutdown() -- that calls process.exit(0), which
  // would kill the test runner.
  server?.close();
});

function authed(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

describe("per-agent authorization, end to end", () => {
  it("rejects a request with no credential at all", async () => {
    const res = await fetch(`${baseUrl}/sessions`);
    expect(res.status).toBe(401);
  });

  it("still lets the master token read unscoped -- baseline, unchanged", async () => {
    const res = await fetch(`${baseUrl}/sessions`, { headers: authed(masterToken) });
    expect(res.status).toBe(200);
  });

  it("refuses a bogus agent id when minting, even with the master token", async () => {
    const res = await fetch(`${baseUrl}/agent-tokens`, {
      method: "POST",
      headers: { ...authed(masterToken), "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(400);
  });

  it("mints a per-agent token for a real agent with the master token", async () => {
    const res = await fetch(`${baseUrl}/agent-tokens`, {
      method: "POST",
      headers: { ...authed(masterToken), "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentA.id }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; expiresAt: string };
    expect(body.token).toBeTruthy();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("a per-agent token cannot itself mint another token", async () => {
    const mint = await fetch(`${baseUrl}/agent-tokens`, {
      method: "POST",
      headers: { ...authed(masterToken), "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentA.id }),
    });
    const { token: agentToken } = (await mint.json()) as { token: string };

    const res = await fetch(`${baseUrl}/agent-tokens`, {
      method: "POST",
      headers: { ...authed(agentToken), "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentB.id }),
    });
    expect(res.status).toBe(403);
  });

  it("a per-agent token works for its own agent, is refused for another, and is refused unscoped", async () => {
    const mint = await fetch(`${baseUrl}/agent-tokens`, {
      method: "POST",
      headers: { ...authed(masterToken), "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentA.id }),
    });
    const { token: agentToken } = (await mint.json()) as { token: string };

    const own = await fetch(`${baseUrl}/sessions?agentId=${agentA.id}`, { headers: authed(agentToken) });
    expect(own.status).toBe(200);

    const other = await fetch(`${baseUrl}/sessions?agentId=${agentB.id}`, { headers: authed(agentToken) });
    expect(other.status).toBe(403);

    // This is the crux of the gap being closed: possessing a valid token no
    // longer means being able to name any agent, or read across all of them.
    const unscoped = await fetch(`${baseUrl}/sessions`, { headers: authed(agentToken) });
    expect(unscoped.status).toBe(403);
  });
});
