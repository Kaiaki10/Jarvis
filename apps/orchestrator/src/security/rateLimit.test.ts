import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "./rateLimit.js";

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit within the window, per key", () => {
    const limiter = new SlidingWindowLimiter(2, 1_000);
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 100)).toBe(true);
    expect(limiter.take("a", 200)).toBe(false);
    expect(limiter.take("b", 200)).toBe(true);
  });

  it("frees capacity as old hits leave the window, and does not count refusals", () => {
    const limiter = new SlidingWindowLimiter(2, 1_000);
    limiter.take("a", 0);
    limiter.take("a", 500);
    expect(limiter.take("a", 900)).toBe(false);
    expect(limiter.retryAfterSeconds("a", 900)).toBe(1);
    expect(limiter.take("a", 1_000)).toBe(true);
    expect(limiter.take("a", 1_200)).toBe(false);
    expect(limiter.take("a", 1_500)).toBe(true);
  });

  it("stays bounded under many distinct keys", () => {
    const limiter = new SlidingWindowLimiter(1, 60_000, 100);
    for (let i = 0; i < 1_000; i++) limiter.take(`ip-${i}`, i);
    expect((limiter as unknown as { hits: Map<string, number[]> }).hits.size).toBeLessThanOrEqual(100);
  });
});
