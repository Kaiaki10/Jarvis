import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db.js";
import { activeAdBudgetMinor } from "../db/paidGrowthRepo.js";
import { checkCapacity, setEnvelope } from "../billing/envelopes.js";

function campaign(id: string, dailyBudgetMinor: number, status = "active", currency = "USD") {
  db.prepare(
    `INSERT INTO paid_growth_campaigns
      (id, agent_id, workflow_id, name, objective, platform, external_campaign_id,
       external_budget_entity_id, status, currency, daily_budget_minor, lifetime_budget_minor,
       approved_budget_minor, spent_minor, revenue_minor, impressions, clicks, conversions,
       target_roas, start_date, end_date, last_synced_at, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, 'o', 'google_ads', 'ext', NULL, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, NULL, '2026-01-01', NULL, NULL, '', '')`
  ).run(id, id, status, currency, dailyBudgetMinor);
}

describe("ad budget capacity", () => {
  beforeEach(() => {
    db.exec("DELETE FROM paid_growth_campaigns");
    db.exec("DELETE FROM spend_envelopes");
  });

  it("sums the daily budgets of live campaigns only", () => {
    campaign("a", 5_000);
    campaign("b", 3_000);
    campaign("paused", 9_000, "paused");
    // A paused campaign draws nothing, so holding its budget against the
    // envelope would block new launches for no reason.
    expect(activeAdBudgetMinor("USD")).toBe(8_000);
  });

  it("keeps currencies apart, since envelopes never convert", () => {
    campaign("usd", 5_000, "active", "USD");
    campaign("eur", 9_000, "active", "EUR");
    expect(activeAdBudgetMinor("USD")).toBe(5_000);
    expect(activeAdBudgetMinor("EUR")).toBe(9_000);
  });

  it("can exclude campaigns whose budget is being replaced", () => {
    campaign("a", 5_000);
    campaign("b", 3_000);
    expect(activeAdBudgetMinor("USD", ["a"])).toBe(3_000);
    expect(activeAdBudgetMinor("USD", ["a", "b"])).toBe(0);
  });

  it("refuses a launch when no ad envelope is set", () => {
    const check = checkCapacity({
      rail: "ad_budget", committedMinor: 0, addingMinor: 5_000, currency: "USD", period: "day",
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/No daily limit is set/);
  });

  it("allows a launch that fits alongside what is already running", () => {
    setEnvelope({ rail: "ad_budget", period: "day", limitMinor: 10_000, currency: "USD" });
    campaign("running", 6_000);
    const check = checkCapacity({
      rail: "ad_budget",
      committedMinor: activeAdBudgetMinor("USD"),
      addingMinor: 4_000,
      currency: "USD",
      period: "day",
    });
    expect(check.allowed).toBe(true);
  });

  it("blocks a launch that would push total daily commitment over the envelope", () => {
    setEnvelope({ rail: "ad_budget", period: "day", limitMinor: 10_000, currency: "USD" });
    campaign("running", 8_000);
    const check = checkCapacity({
      rail: "ad_budget",
      committedMinor: activeAdBudgetMinor("USD"),
      addingMinor: 4_000,
      currency: "USD",
      period: "day",
    });
    expect(check.allowed).toBe(false);
  });

  it("counts only the delta on an increase, not the whole new budget", () => {
    setEnvelope({ rail: "ad_budget", period: "day", limitMinor: 10_000, currency: "USD" });
    campaign("target", 6_000);
    campaign("other", 2_000);

    // Raising target 6k -> 7k is +1k, giving 9k of 10k. Counting the full 7k
    // against the existing 8k would wrongly read as 15k and refuse it.
    const check = checkCapacity({
      rail: "ad_budget",
      committedMinor: activeAdBudgetMinor("USD", ["target"]),
      addingMinor: 7_000,
      currency: "USD",
      period: "day",
    });
    expect(check.allowed).toBe(true);
  });

  it("catches a reallocation that grows the total despite cutting the source", () => {
    setEnvelope({ rail: "ad_budget", period: "day", limitMinor: 10_000, currency: "USD" });
    campaign("source", 5_000);
    campaign("target", 4_000);

    // Source cut 20% to 4,000; target raised to 7,000. Total 11,000 of 10,000 —
    // a cut on one side does not make a reallocation automatically neutral.
    const check = checkCapacity({
      rail: "ad_budget",
      committedMinor: activeAdBudgetMinor("USD", ["source", "target"]),
      addingMinor: 7_000 + 4_000,
      currency: "USD",
      period: "day",
    });
    expect(check.allowed).toBe(false);
  });
});
