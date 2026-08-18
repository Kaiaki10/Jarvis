import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDeferredWithTimeout } from "./deferredWithTimeout.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createDeferredWithTimeout", () => {
  it("resolves with the settled value when answered in time", async () => {
    const d = createDeferredWithTimeout(1000, () => "timed-out");
    d.settle("answered");
    await expect(d.promise).resolves.toBe("answered");
  });

  it("resolves with the timeout value when nobody answers", async () => {
    const d = createDeferredWithTimeout(1000, () => "timed-out");
    vi.advanceTimersByTime(1000);
    await expect(d.promise).resolves.toBe("timed-out");
  });

  it("does not time out early", async () => {
    const onTimeout = vi.fn(() => "timed-out");
    createDeferredWithTimeout(1000, onTimeout);
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("ignores a timeout that fires after an answer", async () => {
    const onTimeout = vi.fn(() => "timed-out");
    const d = createDeferredWithTimeout(1000, onTimeout);
    expect(d.settle("answered")).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
    await expect(d.promise).resolves.toBe("answered");
  });

  it("ignores an answer that arrives after the timeout", async () => {
    const d = createDeferredWithTimeout(1000, () => "timed-out");
    vi.advanceTimersByTime(1000);
    expect(d.settle("too-late")).toBe(false);
    await expect(d.promise).resolves.toBe("timed-out");
  });

  it("settles only once even when called repeatedly", async () => {
    const d = createDeferredWithTimeout(1000, () => "timed-out");
    expect(d.settle("first")).toBe(true);
    expect(d.settle("second")).toBe(false);
    expect(d.settle("third")).toBe(false);
    await expect(d.promise).resolves.toBe("first");
  });

  it("never times out when the timeout is zero or negative", () => {
    const onTimeout = vi.fn(() => "timed-out");
    const zero = createDeferredWithTimeout(0, onTimeout);
    const negative = createDeferredWithTimeout(-1, onTimeout);
    vi.advanceTimersByTime(10 * 60 * 60 * 1000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(zero.expiresAt).toBeNull();
    expect(negative.expiresAt).toBeNull();
  });

  it("reports an expiry only when there is a deadline", () => {
    expect(createDeferredWithTimeout(1000, () => null).expiresAt).toBeInstanceOf(Date);
    expect(createDeferredWithTimeout(0, () => null).expiresAt).toBeNull();
  });

  it("stops the timer when cancelled", () => {
    const onTimeout = vi.fn(() => "timed-out");
    const d = createDeferredWithTimeout(1000, onTimeout);
    d.cancel();
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(d.isSettled()).toBe(true);
  });

  it("tracks settled state", () => {
    const d = createDeferredWithTimeout(1000, () => "x");
    expect(d.isSettled()).toBe(false);
    d.settle("y");
    expect(d.isSettled()).toBe(true);
  });
});
