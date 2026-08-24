import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { computeNextRun } from "./scheduleTime.js";

const sessionManagerMocks = vi.hoisted(() => ({
  atConcurrencyLimit: vi.fn(() => false),
  isCwdBusy: vi.fn(() => false),
  startSession: vi.fn(async () => {}),
}));

vi.mock("../sessions/sessionManager.js", () => sessionManagerMocks);

describe("tick", () => {
  beforeEach(async () => {
    sessionManagerMocks.atConcurrencyLimit.mockReturnValue(false);
    sessionManagerMocks.isCwdBusy.mockReturnValue(false);
    sessionManagerMocks.startSession.mockClear();
    const { db } = await import("../db/db.js");
    db.exec("DELETE FROM scheduled_tasks");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const past = () => new Date(Date.now() - 60_000).toISOString();

  it("skips a due task whose cwd already has a run in flight, and fires the next due task instead", async () => {
    const { createScheduledTask, listEnabledScheduledTasks } = await import("../db/repo.js");
    const { tick } = await import("./scheduler.js");

    const busy = createScheduledTask({
      prompt: "Follow AUTOMATION_RULES.md",
      cwd: "C:/jarvis-lab",
      permissionMode: "default",
      timeOfDay: "09:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      nextRunAt: past(),
    });
    const free = createScheduledTask({
      prompt: "Some other automation",
      cwd: "C:/jarvis-other",
      permissionMode: "default",
      timeOfDay: "09:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      nextRunAt: past(),
    });

    sessionManagerMocks.isCwdBusy.mockImplementation((cwd: string) => cwd === "C:/jarvis-lab");

    tick();

    expect(sessionManagerMocks.startSession).toHaveBeenCalledTimes(1);
    expect(sessionManagerMocks.startSession.mock.calls[0][0]).toMatchObject({ prompt: "Some other automation" });

    const after = listEnabledScheduledTasks();
    // The busy one was left untouched — still due, to be retried next tick.
    expect(after.find((t) => t.id === busy.id)?.lastRunAt).toBeNull();
    // The free one actually fired.
    const firedFree = after.find((t) => t.id === free.id);
    expect(firedFree?.lastRunAt).not.toBeNull();
    expect(firedFree?.nextRunAt).not.toBe(free.nextRunAt);
  });

  it("fires a due task normally when nothing else is using its cwd", async () => {
    const { createScheduledTask, listEnabledScheduledTasks } = await import("../db/repo.js");
    const { tick } = await import("./scheduler.js");

    const task = createScheduledTask({
      prompt: "Follow AUTOMATION_RULES.md",
      cwd: "C:/jarvis-lab-2",
      permissionMode: "default",
      timeOfDay: "09:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      nextRunAt: past(),
    });

    tick();

    expect(sessionManagerMocks.startSession).toHaveBeenCalledTimes(1);
    const after = listEnabledScheduledTasks().find((t) => t.id === task.id);
    expect(after?.lastRunAt).not.toBeNull();
  });

  it("auto-approves local-work tools, since nobody is watching a cron fire to click approve", async () => {
    const { createScheduledTask, listEnabledScheduledTasks, getSession } = await import("../db/repo.js");
    const { tick } = await import("./scheduler.js");

    const task = createScheduledTask({
      prompt: "Follow AUTOMATION_RULES.md",
      cwd: "C:/jarvis-lab-3",
      permissionMode: "acceptEdits",
      timeOfDay: "09:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      nextRunAt: past(),
    });

    tick();

    // The mocked startSession call — what sessionManager actually receives.
    expect(sessionManagerMocks.startSession.mock.calls[0][0]).toMatchObject({
      autoApproveLocalTools: true,
    });

    // The session record createSession wrote — what the dashboard reads back.
    const sessionId = listEnabledScheduledTasks().find((t) => t.id === task.id)?.lastSessionId;
    expect(getSession(sessionId!)?.autoApproveLocalTools).toBe(true);
  });
});

describe("nextRetryAt", () => {
  it("retries on the short cadence when the account isn't rate-limited", async () => {
    const { resetUsageForTests } = await import("../sessions/claudeUsage.js");
    const { nextRetryAt } = await import("./scheduler.js");
    resetUsageForTests();

    const before = Date.now();
    const at = nextRetryAt().getTime();
    // ~5 minutes out, not hours or days.
    expect(at - before).toBeGreaterThan(4 * 60_000);
    expect(at - before).toBeLessThan(6 * 60_000);
  });

  it("waits for the reported reset instant when the turn was rejected for hitting a usage limit", async () => {
    const { recordRateLimit, resetUsageForTests } = await import("../sessions/claudeUsage.js");
    const { nextRetryAt } = await import("./scheduler.js");
    resetUsageForTests();

    // Four real retries burned in under an hour this way on 2026-08-19, every
    // one reporting a reset time none of them could have beaten. A window
    // that resets hours from now must push the retry out that far, not 5min.
    const resetsAtSeconds = Math.floor(Date.now() / 1000) + 3 * 60 * 60;
    recordRateLimit({ rateLimitType: "five_hour", status: "rejected", resetsAt: resetsAtSeconds });

    const at = nextRetryAt().getTime();
    expect(at).toBeGreaterThanOrEqual(resetsAtSeconds * 1000);
    // Some slack past the exact instant, not hours of it.
    expect(at - resetsAtSeconds * 1000).toBeLessThan(5 * 60_000);
  });

  it("also accepts resetsAt reported in milliseconds", async () => {
    const { recordRateLimit, resetUsageForTests } = await import("../sessions/claudeUsage.js");
    const { nextRetryAt } = await import("./scheduler.js");
    resetUsageForTests();

    const resetsAtMs = Date.now() + 2 * 60 * 60 * 1000;
    recordRateLimit({ rateLimitType: "five_hour", status: "rejected", resetsAt: resetsAtMs });

    const at = nextRetryAt().getTime();
    expect(at).toBeGreaterThanOrEqual(resetsAtMs);
    expect(at - resetsAtMs).toBeLessThan(5 * 60_000);
  });

  it("falls back to the short cadence once the reported reset time has already passed", async () => {
    const { recordRateLimit, resetUsageForTests } = await import("../sessions/claudeUsage.js");
    const { nextRetryAt } = await import("./scheduler.js");
    resetUsageForTests();

    const resetsAtSeconds = Math.floor(Date.now() / 1000) - 60;
    recordRateLimit({ rateLimitType: "five_hour", status: "rejected", resetsAt: resetsAtSeconds });

    const before = Date.now();
    const at = nextRetryAt().getTime();
    expect(at - before).toBeGreaterThan(4 * 60_000);
    expect(at - before).toBeLessThan(6 * 60_000);
  });
});

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
