import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * The first real HTTP-layer integration test in this repo: boots the actual
 * Express app on an OS-assigned ephemeral port (never the live service's
 * :4317) and issues real requests against it, so the auth middleware and
 * route wiring are proven together rather than only in isolation.
 */
let baseUrl: string;
let masterToken: string;
let server: Server;
let legacyAgent: { id: string };

beforeAll(async () => {
  // Importing server.ts pulls in essentially the whole app's module graph
  // (scheduler, paid growth, customers, ...) for the
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
  // A pre-2.0 database can still hold a second agent's rows.
  legacyAgent = createAgent({ name: "Legacy" });

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

describe("Jarvis 2.0 HTTP surface", () => {
  it("refuses a request with no token or a wrong one", async () => {
    expect((await fetch(`${baseUrl}/sessions`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/sessions`, { headers: authed("nope") })).status).toBe(401);
  });

  it("serves unscoped reads with the master token", async () => {
    const res = await fetch(`${baseUrl}/sessions`, { headers: authed(masterToken) });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("exposes Jarvis as one agent record and patches its brain", async () => {
    const got = await fetch(`${baseUrl}/agent`, { headers: authed(masterToken) });
    expect(got.status).toBe(200);
    expect((await got.json()).name).toBe("Jarvis");

    const patched = await fetch(`${baseUrl}/agent`, {
      method: "PATCH",
      headers: { ...authed(masterToken), "Content-Type": "application/json" },
      body: JSON.stringify({ brainLane: "local", brainModel: "qwen3:14b" }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ brainLane: "local", brainModel: "qwen3:14b" });
  });

  it("treats business context and Jarvis's persona as one value", async () => {
    const headers = { ...authed(masterToken), "Content-Type": "application/json" };
    const saved = await fetch(`${baseUrl}/settings`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ businessContext: "We sell hand-thrown mugs." }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).businessContext).toBe("We sell hand-thrown mugs.");
    const agent = await (await fetch(`${baseUrl}/agent`, { headers: authed(masterToken) })).json();
    expect(agent.systemPrompt).toBe("We sell hand-thrown mugs.");
  });

  it("no longer serves the removed multi-agent, room, and evolution routes", async () => {
    for (const path of ["/agents", "/conversations", "/evolution"]) {
      expect((await fetch(`${baseUrl}${path}`, { headers: authed(masterToken) })).status).toBe(404);
    }
  });

  it("still narrows to a legacy agent by id, and rejects an unknown one", async () => {
    const known = await fetch(`${baseUrl}/sessions?agentId=${legacyAgent.id}`, { headers: authed(masterToken) });
    expect(known.status).toBe(200);
    const unknown = await fetch(`${baseUrl}/sessions?agentId=00000000-0000-4000-8000-00000000dead`, { headers: authed(masterToken) });
    expect(unknown.status).toBe(400);
  });
});
