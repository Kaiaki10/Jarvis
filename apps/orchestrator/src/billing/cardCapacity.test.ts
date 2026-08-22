import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db.js";
import { checkCapacity, setEnvelope } from "./envelopes.js";
import { activeCardCapacityMinor } from "./stripeFunding.js";

function card(id: string, limitMinor: number | null, status = "active") {
  db.prepare(
    `INSERT INTO stripe_cards (card_id, purpose_label, monthly_limit_minor, brand, last4, status, created_at)
     VALUES (?, ?, ?, 'Visa', '4242', ?, '')`
  ).run(id, id, limitMinor, status);
}

describe("card capacity", () => {
  beforeEach(() => {
    db.exec("DELETE FROM stripe_cards");
    db.exec("DELETE FROM spend_envelopes");
    db.exec("DELETE FROM spend_ledger");
  });

  it("sums the limits of cards that can still be charged", () => {
    card("a", 20_000);
    card("b", 30_000);
    expect(activeCardCapacityMinor()).toBe(50_000);
  });

  it("frees the allowance when a card is retired", () => {
    card("a", 20_000);
    card("b", 30_000, "inactive");
    // cancelStripeCard writes 'inactive'; Stripe itself reports 'canceled'.
    expect(activeCardCapacityMinor()).toBe(20_000);
  });

  it("excludes Stripe's own spelling of cancelled too", () => {
    card("a", 20_000, "canceled");
    expect(activeCardCapacityMinor()).toBe(0);
  });

  it("counts a card issued before limits were recorded as zero, not as a guess", () => {
    card("legacy", null);
    card("new", 10_000);
    expect(activeCardCapacityMinor()).toBe(10_000);
  });

  it("refuses a new card with no envelope set", () => {
    const check = checkCapacity({
      rail: "card", committedMinor: 0, addingMinor: 10_000, currency: "USD", period: "month",
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/No monthly limit is set/);
  });

  it("allows a card that fits the remaining envelope", () => {
    setEnvelope({ rail: "card", period: "month", limitMinor: 50_000, currency: "USD" });
    const check = checkCapacity({
      rail: "card", committedMinor: 30_000, addingMinor: 20_000, currency: "USD", period: "month",
    });
    expect(check.allowed).toBe(true);
  });

  it("blocks a card that would push total authority over the envelope", () => {
    setEnvelope({ rail: "card", period: "month", limitMinor: 50_000, currency: "USD" });
    const check = checkCapacity({
      rail: "card", committedMinor: 40_000, addingMinor: 20_000, currency: "USD", period: "month",
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/over the monthly limit of 50000/);
  });

  it("is not fooled by a wallet envelope in a different currency", () => {
    setEnvelope({ rail: "card", period: "month", limitMinor: 50_000, currency: "USDC" });
    const check = checkCapacity({
      rail: "card", committedMinor: 0, addingMinor: 10_000, currency: "USD", period: "month",
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/does not convert between currencies/);
  });
});
