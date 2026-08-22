import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db.js";
import {
  checkEnvelopes,
  listSpendLedger,
  recordSpend,
  setEnvelope,
  spentInPeriod,
} from "./envelopes.js";

describe("spend envelopes", () => {
  beforeEach(() => {
    db.exec("DELETE FROM spend_ledger");
    db.exec("DELETE FROM spend_envelopes");
  });

  it("refuses to spend on a rail with no limit set", () => {
    const check = checkEnvelopes({ rail: "wallet", amountMinor: 1, currency: "USDC" });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/No spending limit is set/);
  });

  it("allows a spend inside the limit", () => {
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 10_000, currency: "USDC" });
    expect(checkEnvelopes({ rail: "wallet", amountMinor: 5_000, currency: "USDC" }).allowed).toBe(true);
  });

  it("blocks a spend that would cross the limit", () => {
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 10_000, currency: "USDC" });
    recordSpend({ rail: "wallet", amountMinor: 8_000, currency: "USDC", reason: "ads" });
    const check = checkEnvelopes({ rail: "wallet", amountMinor: 5_000, currency: "USDC" });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/exceed the daily wallet limit/i);
  });

  it("allows a spend that lands exactly on the limit", () => {
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 10_000, currency: "USDC" });
    recordSpend({ rail: "wallet", amountMinor: 9_000, currency: "USDC", reason: "ads" });
    expect(checkEnvelopes({ rail: "wallet", amountMinor: 1_000, currency: "USDC" }).allowed).toBe(true);
  });

  /**
   * The expensive mistake this prevents: USDC has 6 decimals and USD cents have
   * 2, so comparing them silently would authorise ~10,000x the intended amount.
   */
  it("refuses a currency it has no limit for, rather than converting", () => {
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 10_000, currency: "USDC" });
    const check = checkEnvelopes({ rail: "wallet", amountMinor: 50, currency: "USD" });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/does not convert between currencies/);
  });

  it("enforces every applicable period — a daily allowance does not license the monthly one", () => {
    // A generous day limit against a tight month one, so the month is the only
    // thing under pressure. Backdating a ledger row would test the same thing
    // but break on the first of the month, when there is no "earlier today".
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 100_000, currency: "USDC" });
    setEnvelope({ rail: "wallet", period: "month", limitMinor: 12_000, currency: "USDC" });
    recordSpend({ rail: "wallet", amountMinor: 9_000, currency: "USDC", reason: "earlier" });

    // Fits the day (13k of 100k) and breaks the month (13k of 12k).
    const check = checkEnvelopes({ rail: "wallet", amountMinor: 4_000, currency: "USDC" });
    expect(check.allowed).toBe(false);
    expect(check.envelope?.period).toBe("month");
  });

  it("keeps rails independent", () => {
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 1_000, currency: "USDC" });
    setEnvelope({ rail: "card", period: "day", limitMinor: 5_000, currency: "USD" });
    recordSpend({ rail: "wallet", amountMinor: 1_000, currency: "USDC", reason: "spent out" });

    expect(checkEnvelopes({ rail: "wallet", amountMinor: 1, currency: "USDC" }).allowed).toBe(false);
    expect(checkEnvelopes({ rail: "card", amountMinor: 1_000, currency: "USD" }).allowed).toBe(true);
  });

  it("rejects a negative amount", () => {
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 10_000, currency: "USDC" });
    expect(checkEnvelopes({ rail: "wallet", amountMinor: -5, currency: "USDC" }).allowed).toBe(false);
  });

  it("updates a limit in place rather than stacking envelopes", () => {
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 1_000, currency: "USDC" });
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 9_000, currency: "USDC" });
    expect(checkEnvelopes({ rail: "wallet", amountMinor: 5_000, currency: "USDC" }).allowed).toBe(true);
  });

  it("only counts spending inside the current period", () => {
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 10_000, currency: "USDC" });
    recordSpend({ rail: "wallet", amountMinor: 9_000, currency: "USDC", reason: "today" });
    db.exec("UPDATE spend_ledger SET created_at = '2020-01-01T00:00:00.000Z'");
    expect(spentInPeriod("wallet", "day", "USDC")).toBe(0);
    expect(checkEnvelopes({ rail: "wallet", amountMinor: 9_000, currency: "USDC" }).allowed).toBe(true);
  });

  it("records what a spend was for and its provider reference", () => {
    recordSpend({
      rail: "wallet", amountMinor: 500, currency: "USDC",
      reason: "Ad top-up", externalRef: "0xabc",
    });
    const [entry] = listSpendLedger();
    expect(entry.reason).toBe("Ad top-up");
    expect(entry.externalRef).toBe("0xabc");
    expect(entry.rail).toBe("wallet");
  });
});
