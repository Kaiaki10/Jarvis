import { describe, expect, it } from "vitest";
import {
  buildFallbackSummary,
  compactHistory,
  contextFill,
  estimateMessagesTokens,
  estimateTextTokens,
} from "./localContext.js";

function turn(role: "user" | "assistant", content: string, seq: number) {
  return { role, content, seq };
}

describe("estimateTextTokens", () => {
  it("scales with length at roughly 4 chars per token", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("a".repeat(400))).toBe(100);
    expect(estimateTextTokens("a".repeat(401))).toBe(101);
  });
});

describe("estimateMessagesTokens", () => {
  it("only counts string content", () => {
    expect(estimateMessagesTokens([{ content: "a".repeat(400) }, { content: null }, { content: ["blocks"] }])).toBe(100);
  });
});

describe("compactHistory", () => {
  it("caps oversized turns", () => {
    const entries = [turn("assistant", "x".repeat(2_000), 1)];
    const out = compactHistory(entries, { numCtx: 32768 });
    expect(out[0].content.length).toBeLessThan(2_000);
    expect(out[0].content.endsWith("… (truncated)")).toBe(true);
  });

  it("drops the oldest turns when over budget", () => {
    const entries = Array.from({ length: 20 }, (_, i) => turn(i % 2 === 0 ? "user" : "assistant", "word ".repeat(60), i));
    const out = compactHistory(entries, { numCtx: 512, window: 20 });
    expect(out.length).toBeLessThan(20);
    expect(out[out.length - 1].seq).toBe(19);
  });

  it("keeps at least minKeep entries even when wildly over budget", () => {
    const entries = Array.from({ length: 20 }, (_, i) => turn("user", "word ".repeat(500), i));
    const out = compactHistory(entries, { numCtx: 64, window: 20 });
    expect(out.length).toBeGreaterThanOrEqual(4);
  });

  it("respects the window", () => {
    const entries = Array.from({ length: 10 }, (_, i) => turn("user", "hi", i));
    const out = compactHistory(entries, { numCtx: 32768, window: 3 });
    expect(out.map((e) => e.seq)).toEqual([7, 8, 9]);
  });

  it("reaches the token budget without dropping the newest turn", () => {
    const entries = Array.from({ length: 20 }, (_, i) => turn("user", "word ".repeat(16), i));
    const budget = 256 * 0.7;
    const out = compactHistory(entries, { numCtx: 256, window: 20 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[out.length - 1].seq).toBe(19);
    expect(estimateMessagesTokens(out)).toBeLessThanOrEqual(budget);
  });
});

describe("contextFill", () => {
  it("returns 0 for empty and 1 when blowing past the budget", () => {
    expect(contextFill([], 32768)).toBe(0);
    const huge = [{ content: "x".repeat(400_000) }];
    expect(contextFill(huge, 32768)).toBe(1);
  });
});

describe("buildFallbackSummary", () => {
  it("lists user prompts, skips assistant turns", () => {
    const entries = [turn("user", "Find the bug in the scheduler", 1), turn("assistant", "Here it is", 2)];
    const summary = buildFallbackSummary(entries);
    expect(summary).toContain("Find the bug in the scheduler");
    expect(summary).not.toContain("Here it is");
    expect(summary).toContain("Earlier turns covered these requests (auto-summarized without a model):");
  });

  it("caps the total length", () => {
    const entries = Array.from({ length: 50 }, (_, i) => turn("user", `prompt number ${i} `.repeat(60), i));
    const summary = buildFallbackSummary(entries, 200);
    expect(summary.length).toBeLessThanOrEqual(200);
  });

  it("returns empty when there are no user turns", () => {
    expect(buildFallbackSummary([turn("assistant", "hi", 1)])).toBe("");
  });
});