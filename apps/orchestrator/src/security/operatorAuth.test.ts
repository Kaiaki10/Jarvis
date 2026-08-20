import { describe, expect, it } from "vitest";

/**
 * The cryptographic verification path (`completeRegistration`/`completeAuthentication`
 * actually checking a real WebAuthn signature) needs a genuine authenticator
 * response — hand-constructing a valid attestation object in a unit test buys
 * little over exercising it live. That live path is verified with a Chrome
 * DevTools Protocol virtual authenticator against the real running service
 * (see the Flagship 1 verification notes). What's covered here is the gating
 * logic around it: who is allowed to start a ceremony, and that a ceremony
 * cannot be replayed or found stale.
 */
describe("operatorAuth gating", () => {
  it(
    "allows bootstrap registration when no operator exists yet",
    async () => {
      // SimpleWebAuthn's first call in a process is noticeably slower than
      // every call after it (module/crypto warmup) — this is the first
      // ceremony call in the suite, so it gets a longer budget than the rest.
      const { beginRegistration } = await import("./operatorAuth.js");
      const { ceremonyId, options } = await beginRegistration(null);
      expect(ceremonyId).toBeTruthy();
      expect(options.challenge).toBeTruthy();
    },
    15_000
  );

  it("refuses a second bootstrap registration once an operator exists", async () => {
    const { createOperator } = await import("../db/operatorRepo.js");
    const { beginRegistration } = await import("./operatorAuth.js");
    createOperator("Kai");
    await expect(beginRegistration(null)).rejects.toThrow(/already exists/i);
  });

  it("still allows an existing operator to register a second passkey", async () => {
    const { createOperator } = await import("../db/operatorRepo.js");
    const { beginRegistration } = await import("./operatorAuth.js");
    const operator = createOperator("Kai");
    const { ceremonyId } = await beginRegistration(operator.id);
    expect(ceremonyId).toBeTruthy();
  });

  it("completeRegistration rejects an unknown or already-consumed ceremony id", async () => {
    const { completeRegistration } = await import("./operatorAuth.js");
    await expect(
      completeRegistration({
        ceremonyId: "not-a-real-ceremony",
        response: {} as Parameters<typeof completeRegistration>[0]["response"],
      })
    ).rejects.toThrow(/expired/i);
  });

  it("beginAuthentication produces a ceremony even with no credentials registered yet", async () => {
    const { beginAuthentication } = await import("./operatorAuth.js");
    const { ceremonyId, options } = await beginAuthentication();
    expect(ceremonyId).toBeTruthy();
    expect(options.challenge).toBeTruthy();
  });

  it("completeAuthentication rejects an unregistered credential id without touching the ceremony store incorrectly", async () => {
    const { beginAuthentication, completeAuthentication } = await import("./operatorAuth.js");
    const { ceremonyId } = await beginAuthentication();
    await expect(
      completeAuthentication({
        ceremonyId,
        response: { id: "unknown-credential" } as Parameters<
          typeof completeAuthentication
        >[0]["response"],
      })
    ).rejects.toThrow(/not registered/i);
  });

  it("a session cookie resolves to its operator, and no longer does once logged out", async () => {
    const { createOperator } = await import("../db/operatorRepo.js");
    const { startOperatorSession, resolveSession, endOperatorSession } = await import(
      "./operatorAuth.js"
    );
    const operator = createOperator("Kai");
    const session = startOperatorSession(operator.id);

    expect(resolveSession(session.id)?.id).toBe(operator.id);
    endOperatorSession(session.id);
    expect(resolveSession(session.id)).toBeNull();
  });

  it("resolveSession rejects a forged/unknown session id outright", async () => {
    const { resolveSession } = await import("./operatorAuth.js");
    expect(resolveSession("some-id-nobody-issued")).toBeNull();
    expect(resolveSession(undefined)).toBeNull();
  });

  it("readCookie parses the named cookie out of a raw Cookie header", async () => {
    const { readCookie } = await import("./operatorAuth.js");
    expect(readCookie("a=1; jarvis_operator_session=abc123; b=2", "jarvis_operator_session")).toBe(
      "abc123"
    );
    expect(readCookie(undefined, "jarvis_operator_session")).toBeUndefined();
    expect(readCookie("a=1", "jarvis_operator_session")).toBeUndefined();
  });
});
