import { describe, expect, it, beforeEach } from "vitest";
import { getUsageSnapshot, recordRateLimit, resetUsageForTests } from "./claudeUsage.js";

describe("claudeUsage", () => {
  beforeEach(() => resetUsageForTests());

  it("has nothing to report before any session runs", () => {
    expect(getUsageSnapshot()).toEqual({ windows: [], binding: null });
  });

  /**
   * The exact payload a real `allowed` turn produced against the live account —
   * note the absent `utilization`, which is why it is nullable.
   */
  it("keeps utilization null when the SDK omits it, rather than reporting 0%", () => {
    recordRateLimit({
      status: "allowed",
      resetsAt: 1787355600,
      rateLimitType: "five_hour",
      overageStatus: "rejected",
      isUsingOverage: false,
    });

    const binding = getUsageSnapshot().binding;
    expect(binding?.utilization).toBeNull();
    expect(binding?.resetsAt).toBe(1787355600);
    expect(binding?.type).toBe("five_hour");
  });

  it("reads a fractional utilization as a percentage", () => {
    recordRateLimit({ rateLimitType: "five_hour", utilization: 0.42, status: "allowed" });
    expect(getUsageSnapshot().binding?.utilization).toBe(42);
  });

  it("leaves an already-percentage utilization alone", () => {
    recordRateLimit({ rateLimitType: "five_hour", utilization: 42, status: "allowed" });
    expect(getUsageSnapshot().binding?.utilization).toBe(42);
  });

  it("treats exactly 1 as a full fraction rather than one percent", () => {
    recordRateLimit({ rateLimitType: "five_hour", utilization: 1, status: "allowed" });
    expect(getUsageSnapshot().binding?.utilization).toBe(100);
  });

  it("binds to the most-constrained window, not the most recent", () => {
    recordRateLimit({ rateLimitType: "seven_day", utilization: 0.9, status: "allowed" });
    recordRateLimit({ rateLimitType: "five_hour", utilization: 0.1, status: "allowed" });

    const snapshot = getUsageSnapshot();
    expect(snapshot.binding?.type).toBe("seven_day");
    expect(snapshot.windows.map((w) => w.type)).toEqual(["seven_day", "five_hour"]);
  });

  it("ranks a known utilization above an unknown one", () => {
    recordRateLimit({ rateLimitType: "five_hour", status: "allowed" });
    recordRateLimit({ rateLimitType: "seven_day", utilization: 0.05, status: "allowed" });

    // Even a nearly-empty known window outranks an unknown: it is the only one
    // carrying evidence.
    expect(getUsageSnapshot().binding?.type).toBe("seven_day");
  });

  it("orders unknown windows by which resets soonest", () => {
    recordRateLimit({ rateLimitType: "seven_day", resetsAt: 2000, status: "allowed" });
    recordRateLimit({ rateLimitType: "five_hour", resetsAt: 1000, status: "allowed" });

    expect(getUsageSnapshot().windows.map((w) => w.type)).toEqual(["five_hour", "seven_day"]);
  });

  it("updates a window in place rather than accumulating duplicates", () => {
    recordRateLimit({ rateLimitType: "five_hour", utilization: 0.1, status: "allowed" });
    recordRateLimit({ rateLimitType: "five_hour", utilization: 0.5, status: "allowed" });

    const snapshot = getUsageSnapshot();
    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.binding?.utilization).toBe(50);
  });

  it("ignores an event with no window type, which would overwrite an unrelated window", () => {
    recordRateLimit({ rateLimitType: "five_hour", utilization: 0.3, status: "allowed" });
    recordRateLimit({ utilization: 0.99, status: "rejected" });

    const snapshot = getUsageSnapshot();
    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.binding?.utilization).toBe(30);
  });

  it("survives malformed payloads without throwing", () => {
    expect(() => recordRateLimit(null)).not.toThrow();
    expect(() => recordRateLimit("nonsense")).not.toThrow();
    recordRateLimit({ rateLimitType: "five_hour", utilization: -5, status: "allowed" });
    expect(getUsageSnapshot().binding?.utilization).toBeNull();
  });

  it("keeps a rejected status so the UI can show it stopped", () => {
    recordRateLimit({ rateLimitType: "seven_day", utilization: 1, status: "rejected" });
    expect(getUsageSnapshot().binding?.status).toBe("rejected");
  });
});
