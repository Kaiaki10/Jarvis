import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-auth-watchdog-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
});

beforeEach(async () => {
  const { resetAuthHealthAlerts } = await import("./authWatchdog.js");
  resetAuthHealthAlerts();
  const { db } = await import("../db/db.js");
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM session_events");
  db.exec("DELETE FROM notifications");
});

async function failSession(model: "claude" | "local" | "opencode", errorMessage: string) {
  const { createSession, updateSession, getSession } = await import("../db/repo.js");
  const session = createSession({ title: "Probe", cwd: process.cwd(), permissionMode: "default", model });
  updateSession(session.id, { status: "error", errorMessage });
  return getSession(session.id)!;
}

describe("lane outage classification", () => {
  it("names the exact outages observed live, per lane", async () => {
    const { classifyLaneError } = await import("./authWatchdog.js");
    expect(
      classifyLaneError("claude", "Failed to authenticate: OAuth session expired and could not be refreshed")
    ).toMatchObject({ lane: "claude", title: "Claude login expired" });
    expect(
      classifyLaneError("local", "Ollama returned HTTP 500: boom")
    ).toMatchObject({ lane: "local", title: "Ollama is not answering" });
    expect(
      classifyLaneError("local", "fetch failed")
    ).toMatchObject({ lane: "local" });
    expect(
      classifyLaneError("opencode", "OpenCode refused the request (HTTP 403): FreeTierError")
    ).toMatchObject({ lane: "opencode" });
  });

  it("stays silent on unknown failures and empty messages", async () => {
    const { classifyLaneError } = await import("./authWatchdog.js");
    expect(classifyLaneError("claude", "Some novel model error")).toBeNull();
    expect(classifyLaneError("claude", null)).toBeNull();
    expect(classifyLaneError("claude", "")).toBeNull();
    // A generic fetch failure outside the local lane is not attributable.
    expect(classifyLaneError("claude", "fetch failed")).toBeNull();
  });
});

describe("outage notification", () => {
  it("notifies once per outage no matter how many sessions fail", async () => {
    const { checkAuthHealth } = await import("./authWatchdog.js");
    const { listNotifications } = await import("../notifications/notifier.js");
    await failSession("claude", "Failed to authenticate: OAuth session expired and could not be refreshed");
    await failSession("claude", "Failed to authenticate: OAuth session expired and could not be refreshed");
    expect(checkAuthHealth()).toBe(1);
    expect(checkAuthHealth()).toBe(0);
    expect(listNotifications().filter((n) => n.title === "Claude login expired")).toHaveLength(1);
  });

  it("notifies per lane and re-notifies after recovery", async () => {
    const { checkAuthHealth } = await import("./authWatchdog.js");
    const { listNotifications } = await import("../notifications/notifier.js");
    const { updateSession } = await import("../db/repo.js");
    const failed = await failSession("local", "Ollama returned HTTP 500: boom");
    expect(checkAuthHealth()).toBe(1);
    // Recovery clears the signature: a later recurrence is news again.
    updateSession(failed.id, { status: "completed" });
    expect(checkAuthHealth()).toBe(0);
    await failSession("local", "Ollama returned HTTP 500: boom");
    expect(checkAuthHealth()).toBe(1);
    expect(listNotifications().filter((n) => n.title === "Ollama is not answering")).toHaveLength(2);
  });

  it("ignores stale failures outside the window", async () => {
    const { checkAuthHealth } = await import("./authWatchdog.js");
    const { listNotifications } = await import("../notifications/notifier.js");
    const failed = await failSession("claude", "Failed to authenticate: OAuth session expired");
    const { db } = await import("../db/db.js");
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 60 * 60_000).toISOString(), failed.id);
    expect(checkAuthHealth()).toBe(0);
    expect(listNotifications()).toHaveLength(0);
  });
});
