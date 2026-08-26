import { describe, expect, it } from "vitest";

describe("agentTokenRepo", () => {
  it("mints a URL-safe token tied to a real agent", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createAgentToken, getValidAgentToken } = await import("./agentTokenRepo.js");
    const agent = createAgent({ name: "Token Agent" });

    const record = createAgentToken({ agentId: agent.id, operatorId: null, ttlMs: 60_000 });
    expect(record.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(getValidAgentToken(record.token)?.agentId).toBe(agent.id);
  });

  it("attaches the minting operator when one is given", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createOperator } = await import("./operatorRepo.js");
    const { createAgentToken, getValidAgentToken } = await import("./agentTokenRepo.js");
    const agent = createAgent({ name: "Owned Agent" });
    const operator = createOperator("Kai");

    const record = createAgentToken({ agentId: agent.id, operatorId: operator.id, ttlMs: 60_000 });
    expect(getValidAgentToken(record.token)?.operatorId).toBe(operator.id);
  });

  it("returns undefined for a garbage token", async () => {
    const { getValidAgentToken } = await import("./agentTokenRepo.js");
    expect(getValidAgentToken("not-a-real-token")).toBeUndefined();
  });

  it("is valid until its expiry and invalid after", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createAgentToken, getValidAgentToken } = await import("./agentTokenRepo.js");
    const agent = createAgent({ name: "Expiry Agent" });

    const live = createAgentToken({ agentId: agent.id, operatorId: null, ttlMs: 60_000 });
    expect(getValidAgentToken(live.token)?.agentId).toBe(agent.id);

    const expired = createAgentToken({ agentId: agent.id, operatorId: null, ttlMs: -1 });
    expect(getValidAgentToken(expired.token)).toBeUndefined();
  });

  it("touching a token updates its last-used timestamp", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createAgentToken, getValidAgentToken, touchAgentToken } = await import("./agentTokenRepo.js");
    const agent = createAgent({ name: "Touch Agent" });
    const record = createAgentToken({ agentId: agent.id, operatorId: null, ttlMs: 60_000 });

    await new Promise((resolve) => setTimeout(resolve, 15));
    touchAgentToken(record.token);
    const touched = getValidAgentToken(record.token);
    expect(touched?.lastUsedAt).not.toBe(record.lastUsedAt);
  });
});
