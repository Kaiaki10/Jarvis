import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point at a throwaway database before anything imports the shared connection.
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-spend-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
  process.env.JARVIS_KEY_PATH = join(dir, "test.key");
});

const load = () => import("./spendGuard.js");
const loadRepo = () => import("../db/repo.js");

describe("estimateActionCost", () => {
  it("charges the base rate for a plain post", async () => {
    const { estimateActionCost } = await load();
    expect(estimateActionCost("post_to_x", { text: "hello world" })).toBe(0.015);
  });

  it("charges the URL rate when the text contains a link", async () => {
    const { estimateActionCost } = await load();
    // The 13x surcharge is the whole reason this estimate exists.
    expect(estimateActionCost("post_to_x", { text: "see https://example.com" })).toBe(0.2);
    expect(estimateActionCost("post_to_x", { text: "http://a.co" })).toBe(0.2);
  });

  it("is not fooled by text that merely mentions a domain", async () => {
    const { estimateActionCost } = await load();
    expect(estimateActionCost("post_to_x", { text: "visit example.com later" })).toBe(0.015);
  });

  it("returns zero for platforms with no known rate", async () => {
    const { estimateActionCost } = await load();
    expect(estimateActionCost("post_to_slack", { text: "hi" })).toBe(0);
  });
});

describe("checkDailyCap", () => {
  it("allows actions below the cap and counts them", async () => {
    const { checkDailyCap, recordAction, countActionsToday } = await load();
    const { updateSettings } = await loadRepo();
    updateSettings({ dailyPlatformActionCap: 3 });

    expect(checkDailyCap("x").allowed).toBe(true);
    recordAction("x", "post_to_x");
    recordAction("x", "post_to_x");
    expect(countActionsToday("x")).toBe(2);
    expect(checkDailyCap("x").allowed).toBe(true);
  });

  it("blocks once the cap is reached", async () => {
    const { checkDailyCap, recordAction } = await load();
    const { updateSettings } = await loadRepo();
    updateSettings({ dailyPlatformActionCap: 3 });

    recordAction("x", "post_to_x");
    const check = checkDailyCap("x");
    expect(check.allowed).toBe(false);
    expect(check.used).toBe(3);
    expect(check.message).toMatch(/Daily limit reached/);
  });

  it("counts each platform separately", async () => {
    const { checkDailyCap, countActionsToday } = await load();
    // x is already at its cap; slack must be unaffected.
    expect(countActionsToday("slack")).toBe(0);
    expect(checkDailyCap("slack").allowed).toBe(true);
  });

  it("treats a cap of zero as unlimited", async () => {
    const { checkDailyCap } = await load();
    const { updateSettings } = await loadRepo();
    updateSettings({ dailyPlatformActionCap: 0 });
    expect(checkDailyCap("x").allowed).toBe(true);
  });

  it("reports usage per platform", async () => {
    const { getUsageToday } = await load();
    const usage = getUsageToday();
    const x = usage.find((u) => u.platformId === "x");
    expect(x?.usedToday).toBe(3);
  });
});
