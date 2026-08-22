import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db.js";
import { checkDailyCap, countActionsToday, getUsageToday, recordAction } from "./spendGuard.js";
import { setConnectionCap } from "../db/connectionsRepo.js";
import { updateSettings } from "../db/repo.js";

describe("per-account daily caps", () => {
  beforeEach(() => {
    db.exec("DELETE FROM platform_actions");
    updateSettings({ dailyPlatformActionCap: 2 });
  });

  it("counts against the account, not the whole platform", () => {
    recordAction("x", "post_to_x", null, null, null, "acme-x");
    recordAction("x", "post_to_x", null, null, null, "acme-x");
    expect(countActionsToday("x", "acme-x")).toBe(2);
    expect(countActionsToday("x", "beta-x")).toBe(0);
  });

  it("one business hitting its cap does not starve another", () => {
    recordAction("x", "post_to_x", null, null, null, "acme-x");
    recordAction("x", "post_to_x", null, null, null, "acme-x");

    expect(checkDailyCap("x", "acme-x").allowed).toBe(false);
    // The whole point: Beta still has its own budget.
    expect(checkDailyCap("x", "beta-x").allowed).toBe(true);
  });

  it("still blocks the account that actually overspent", () => {
    recordAction("x", "post_to_x", null, null, null, "acme-x");
    recordAction("x", "post_to_x", null, null, null, "acme-x");
    const check = checkDailyCap("x", "acme-x");
    expect(check.allowed).toBe(false);
    expect(check.used).toBe(2);
  });

  it("falls back to platform-wide counting when no account is known", () => {
    recordAction("x", "post_to_x", null, null, null, "acme-x");
    recordAction("x", "post_to_x", null, null, null, "beta-x");
    // Callers without a connection still get a meaningful total.
    expect(countActionsToday("x")).toBe(2);
  });

  it("treats a cap of zero as unlimited, per account too", () => {
    updateSettings({ dailyPlatformActionCap: 0 });
    recordAction("x", "post_to_x", null, null, null, "acme-x");
    expect(checkDailyCap("x", "acme-x").allowed).toBe(true);
  });
});

describe("editable per-account caps", () => {
  beforeEach(() => {
    db.exec("DELETE FROM platform_actions");
    db.exec("DELETE FROM connections");
    updateSettings({ dailyPlatformActionCap: 25 });
  });

  function account(id: string) {
    db.prepare(
      `INSERT INTO connections (id, agent_id, label, platform_id, credentials, status, created_at, updated_at)
       VALUES (?, NULL, ?, 'x', '{}', 'connected', '', '')`
    ).run(id, id);
    return id;
  }

  it("uses the global default until an account is given its own cap", () => {
    const id = account("acme");
    expect(checkDailyCap("x", id).cap).toBe(25);
  });

  it("lets one account be tightened without touching another", () => {
    const acme = account("acme");
    const beta = account("beta");
    setConnectionCap(acme, 2);

    expect(checkDailyCap("x", acme).cap).toBe(2);
    expect(checkDailyCap("x", beta).cap).toBe(25);
  });

  it("enforces the edited cap, not the default", () => {
    const id = account("acme");
    setConnectionCap(id, 1);
    recordAction("x", "post_to_x", null, null, null, id);
    expect(checkDailyCap("x", id).allowed).toBe(false);
  });

  it("clearing an override falls back to the default rather than removing the limit", () => {
    const id = account("acme");
    setConnectionCap(id, 1);
    setConnectionCap(id, null);
    // The dangerous reading of "clear" would be unlimited. It is not.
    expect(checkDailyCap("x", id).cap).toBe(25);
  });

  it("allows an explicit zero, which means unlimited for that account only", () => {
    const acme = account("acme");
    const beta = account("beta");
    setConnectionCap(acme, 0);
    recordAction("x", "post_to_x", null, null, null, acme);
    expect(checkDailyCap("x", acme).allowed).toBe(true);
    expect(checkDailyCap("x", beta).cap).toBe(25);
  });

  it("reports usage per account against the cap that actually applies", () => {
    const acme = account("acme");
    const beta = account("beta");
    setConnectionCap(acme, 5);
    recordAction("x", "post_to_x", null, null, null, acme);
    recordAction("x", "post_to_x", null, null, null, beta);

    const usage = getUsageToday();
    expect(usage.find((u) => u.connectionId === acme)?.cap).toBe(5);
    expect(usage.find((u) => u.connectionId === beta)?.cap).toBe(25);
  });
});
