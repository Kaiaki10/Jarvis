import { describe, expect, it } from "vitest";
import { authenticate, resolveScopedAgentId, type AuthContext } from "./agentAuth.js";

const MASTER = "master-token";
const isMasterToken = (t: string) => t === MASTER;
const AGENT_TOKENS: Record<string, { agentId: string }> = {
  "token-a": { agentId: "agent-a" },
};
const lookupAgentToken = (t: string) => AGENT_TOKENS[t];

describe("authenticate", () => {
  it("returns null for no token", () => {
    expect(authenticate(undefined, isMasterToken, lookupAgentToken)).toBeNull();
  });

  it("recognizes the master token", () => {
    expect(authenticate(MASTER, isMasterToken, lookupAgentToken)).toEqual({ kind: "master" });
  });

  it("recognizes a valid agent token", () => {
    expect(authenticate("token-a", isMasterToken, lookupAgentToken)).toEqual({ kind: "agent", agentId: "agent-a" });
  });

  it("returns null for an unrecognized token", () => {
    expect(authenticate("garbage", isMasterToken, lookupAgentToken)).toBeNull();
  });
});

const KNOWN_AGENTS = new Set(["agent-a", "agent-b"]);
const agentExists = (id: string) => KNOWN_AGENTS.has(id);
const master: AuthContext = { kind: "master" };
const asAgentA: AuthContext = { kind: "agent", agentId: "agent-a" };

describe("resolveScopedAgentId", () => {
  it("lets the master token through unscoped -- the widest read stays master-only", () => {
    expect(resolveScopedAgentId({ requestedAgentId: undefined, agentExists, auth: master }))
      .toEqual({ ok: true, agentId: undefined });
  });

  it("lets the master token name any known agent", () => {
    expect(resolveScopedAgentId({ requestedAgentId: "agent-b", agentExists, auth: master }))
      .toEqual({ ok: true, agentId: "agent-b" });
  });

  it("400s the master token on an unknown agent", () => {
    expect(resolveScopedAgentId({ requestedAgentId: "ghost", agentExists, auth: master }))
      .toEqual({ ok: false, status: 400, error: "Unknown agent" });
  });

  it("refuses an agent token on an unscoped request -- this is the crux of the gap", () => {
    // A per-agent token proves entitlement to exactly one agent. Letting it
    // through unscoped would let it read every agent's data, defeating the
    // point of scoping it in the first place.
    const result = resolveScopedAgentId({ requestedAgentId: undefined, agentExists, auth: asAgentA });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("lets an agent token through for its own agent", () => {
    expect(resolveScopedAgentId({ requestedAgentId: "agent-a", agentExists, auth: asAgentA }))
      .toEqual({ ok: true, agentId: "agent-a" });
  });

  it("refuses an agent token naming a different, real agent", () => {
    const result = resolveScopedAgentId({ requestedAgentId: "agent-b", agentExists, auth: asAgentA });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("400s an agent token naming an unknown agent, before the mismatch check", () => {
    const result = resolveScopedAgentId({ requestedAgentId: "ghost", agentExists, auth: asAgentA });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});
