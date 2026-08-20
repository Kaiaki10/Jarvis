import { describe, expect, it } from "vitest";

describe("operatorRepo", () => {
  it("starts with no operators", async () => {
    const { countOperators } = await import("./operatorRepo.js");
    expect(countOperators()).toBe(0);
  });

  it("creates an operator and finds it by id", async () => {
    const { createOperator, getOperator } = await import("./operatorRepo.js");
    const operator = createOperator("Kai");
    expect(operator.displayName).toBe("Kai");
    expect(getOperator(operator.id)?.id).toBe(operator.id);
  });

  it("round-trips a credential, including its transports", async () => {
    const { createOperator, addCredential, getCredential } = await import("./operatorRepo.js");
    const operator = createOperator("Kai");
    addCredential({
      credentialId: "cred-1",
      operatorId: operator.id,
      publicKey: "cGVuZGluZw",
      counter: 0,
      transports: ["internal", "hybrid"],
      deviceLabel: "Windows Hello",
    });
    const credential = getCredential("cred-1");
    expect(credential?.operatorId).toBe(operator.id);
    expect(credential?.transports).toEqual(["internal", "hybrid"]);
    expect(credential?.deviceLabel).toBe("Windows Hello");
  });

  it("persists an updated counter, the replay-detection signal", async () => {
    const { createOperator, addCredential, getCredential, touchCredential } = await import(
      "./operatorRepo.js"
    );
    const operator = createOperator("Kai");
    addCredential({ credentialId: "cred-2", operatorId: operator.id, publicKey: "abc", counter: 0 });
    touchCredential("cred-2", 7);
    const credential = getCredential("cred-2");
    expect(credential?.counter).toBe(7);
    expect(credential?.lastUsedAt).not.toBeNull();
  });

  it("a session is valid until its expiry and invalid after", async () => {
    const { createOperator, createOperatorSession, getValidOperatorSession } = await import(
      "./operatorRepo.js"
    );
    const operator = createOperator("Kai");
    const live = createOperatorSession({ operatorId: operator.id, ttlMs: 60_000 });
    expect(getValidOperatorSession(live.id)?.operatorId).toBe(operator.id);

    const expired = createOperatorSession({ operatorId: operator.id, ttlMs: -1 });
    expect(getValidOperatorSession(expired.id)).toBeUndefined();
  });

  it("deleting a session invalidates it immediately", async () => {
    const { createOperator, createOperatorSession, getValidOperatorSession, deleteOperatorSession } =
      await import("./operatorRepo.js");
    const operator = createOperator("Kai");
    const session = createOperatorSession({ operatorId: operator.id, ttlMs: 60_000 });
    deleteOperatorSession(session.id);
    expect(getValidOperatorSession(session.id)).toBeUndefined();
  });

  it("a WebAuthn challenge is single-use: consuming it once empties it for good", async () => {
    const { createWebauthnChallenge, consumeWebauthnChallenge } = await import("./operatorRepo.js");
    const id = createWebauthnChallenge({ type: "registration", challenge: "abc123", ttlMs: 60_000 });
    const first = consumeWebauthnChallenge(id);
    expect(first?.challenge).toBe("abc123");
    expect(consumeWebauthnChallenge(id)).toBeUndefined();
  });

  it("an expired challenge cannot be consumed even before it is swept", async () => {
    const { createWebauthnChallenge, consumeWebauthnChallenge } = await import("./operatorRepo.js");
    const id = createWebauthnChallenge({ type: "authentication", challenge: "xyz", ttlMs: -1 });
    expect(consumeWebauthnChallenge(id)).toBeUndefined();
  });
});
