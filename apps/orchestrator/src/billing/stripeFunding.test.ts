import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMocks = vi.hoisted(() => ({
  balanceRetrieve: vi.fn(),
  cardsCreate: vi.fn(),
  cardsUpdate: vi.fn(),
  ephemeralKeysCreate: vi.fn(),
}));

vi.mock("stripe", () => {
  class MockStripe {
    static API_VERSION = "2026-07-29.dahlia";
    balance = { retrieve: stripeMocks.balanceRetrieve };
    issuing = { cards: { create: stripeMocks.cardsCreate, update: stripeMocks.cardsUpdate } };
    ephemeralKeys = { create: stripeMocks.ephemeralKeysCreate };
  }
  return { default: MockStripe };
});

async function connectStripe() {
  const { saveConnection } = await import("../db/connectionsRepo.js");
  saveConnection("stripe", {
    secretKey: "rk_test_abc",
    publishableKey: "pk_test_abc",
    cardholderId: "ich_test_abc",
  });
}

describe("stripeFunding", () => {
  beforeEach(() => {
    Object.values(stripeMocks).forEach((mock) => mock.mockReset());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses to read balance before Stripe is connected", async () => {
    const { getIssuingBalance } = await import("./stripeFunding.js");
    await expect(getIssuingBalance()).rejects.toThrow(/not connected/i);
  });

  it("reads the Issuing-specific balance line, not the general one", async () => {
    await connectStripe();
    stripeMocks.balanceRetrieve.mockResolvedValue({
      available: [{ amount: 999999, currency: "usd" }],
      issuing: { available: [{ amount: 5000, currency: "usd" }] },
    });
    const { getIssuingBalance } = await import("./stripeFunding.js");
    const balance = await getIssuingBalance();
    expect(balance).toEqual([{ amount: 5000, currency: "usd" }]);
  });

  it("issues a card, storing only non-sensitive fields locally", async () => {
    await connectStripe();
    stripeMocks.cardsCreate.mockResolvedValue({
      id: "ic_test_1",
      brand: "Visa",
      last4: "4242",
      status: "active",
    });
    const { issueStripeCard, listStripeCards } = await import("./stripeFunding.js");
    const card = await issueStripeCard({ purposeLabel: "Anthropic Console", monthlyLimitMinor: 20000 });

    expect(card).toMatchObject({ cardId: "ic_test_1", purposeLabel: "Anthropic Console", brand: "Visa", last4: "4242", status: "active" });
    expect(stripeMocks.cardsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        cardholder: "ich_test_abc",
        currency: "usd",
        type: "virtual",
        spending_controls: { spending_limits: [{ amount: 20000, interval: "monthly" }] },
      })
    );

    const stored = listStripeCards().find((c) => c.cardId === "ic_test_1");
    expect(stored).toBeDefined();
    // Only what Stripe already shows on a receipt — nothing PCI-sensitive.
    expect(Object.keys(stored as object).sort()).toEqual(
      ["brand", "cardId", "createdAt", "last4", "purposeLabel", "status"].sort()
    );
  });

  it("cancelling a card marks it inactive both at Stripe and locally", async () => {
    await connectStripe();
    stripeMocks.cardsCreate.mockResolvedValue({ id: "ic_test_2", brand: "Visa", last4: "1111", status: "active" });
    stripeMocks.cardsUpdate.mockResolvedValue({});
    const { issueStripeCard, cancelStripeCard, listStripeCards } = await import("./stripeFunding.js");
    await issueStripeCard({ purposeLabel: "Google Ads", monthlyLimitMinor: 10000 });
    await cancelStripeCard("ic_test_2");

    expect(stripeMocks.cardsUpdate).toHaveBeenCalledWith("ic_test_2", { status: "inactive" });
    expect(listStripeCards().find((c) => c.cardId === "ic_test_2")?.status).toBe("inactive");
  });

  it("refuses a reveal session for a card Jarvis never issued, without calling Stripe at all", async () => {
    await connectStripe();
    const { createCardRevealSession } = await import("./stripeFunding.js");
    await expect(createCardRevealSession("ic_not_ours", "nonce-123")).rejects.toThrow(/unknown card/i);
    expect(stripeMocks.ephemeralKeysCreate).not.toHaveBeenCalled();
  });

  it("creates a reveal session for a card Jarvis does track", async () => {
    await connectStripe();
    stripeMocks.cardsCreate.mockResolvedValue({ id: "ic_test_3", brand: "Visa", last4: "2222", status: "active" });
    stripeMocks.ephemeralKeysCreate.mockResolvedValue({ secret: "ek_secret_abc" });
    const { issueStripeCard, createCardRevealSession } = await import("./stripeFunding.js");
    await issueStripeCard({ purposeLabel: "Meta Ads", monthlyLimitMinor: 15000 });

    const session = await createCardRevealSession("ic_test_3", "nonce-456");
    expect(session).toEqual({ ephemeralKeySecret: "ek_secret_abc" });
    expect(stripeMocks.ephemeralKeysCreate).toHaveBeenCalledWith(
      { nonce: "nonce-456", issuing_card: "ic_test_3" },
      { apiVersion: "2026-07-29.dahlia" }
    );
  });
});
