import { describe, it, expect } from "vitest";
import { computeNextRun } from "./scheduleTime.js";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

/** Local time, so results can be asserted against local getHours/getDay. */
function at(iso: string): Date {
  return new Date(iso);
}

describe("computeNextRun", () => {
  it("returns later today when the time has not passed yet", () => {
    const from = at("2026-08-17T06:00:00"); // Monday morning
    const next = computeNextRun("09:30", ALL_DAYS, from);
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(17);
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(30);
  });

  it("rolls to tomorrow once today's time has passed", () => {
    const from = at("2026-08-17T10:00:00");
    const next = computeNextRun("09:30", ALL_DAYS, from);
    expect(next!.getDate()).toBe(18);
    expect(next!.getHours()).toBe(9);
  });

  it("treats an exactly-equal time as already past, never returning `from`", () => {
    const from = at("2026-08-17T09:30:00");
    const next = computeNextRun("09:30", ALL_DAYS, from);
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
    expect(next!.getDate()).toBe(18);
  });

  it("skips days that are not selected", () => {
    const from = at("2026-08-21T18:00:00"); // Friday evening
    const next = computeNextRun("09:00", WEEKDAYS, from);
    expect(next!.getDay()).toBe(1); // Monday
    expect(next!.getDate()).toBe(24);
  });

  it("handles a single weekly day by jumping a full week", () => {
    const from = at("2026-08-17T12:00:00"); // Monday
    const next = computeNextRun("08:00", [1], from);
    expect(next!.getDay()).toBe(1);
    expect(next!.getDate()).toBe(24);
  });

  it("returns null when no days are selected", () => {
    expect(computeNextRun("08:00", [], at("2026-08-17T12:00:00"))).toBeNull();
  });

  it("zeroes seconds and milliseconds so runs land on the minute", () => {
    const next = computeNextRun("09:30", ALL_DAYS, at("2026-08-17T06:00:12.345"));
    expect(next!.getSeconds()).toBe(0);
    expect(next!.getMilliseconds()).toBe(0);
  });

  it("crosses a month boundary correctly", () => {
    const from = at("2026-08-31T23:00:00");
    const next = computeNextRun("07:00", ALL_DAYS, from);
    expect(next!.getMonth()).toBe(8); // September (0-indexed)
    expect(next!.getDate()).toBe(1);
  });
});
