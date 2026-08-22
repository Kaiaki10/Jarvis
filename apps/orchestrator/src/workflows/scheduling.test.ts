import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/db.js";
import {
  createContentItem,
  createWorkflow,
  listDueContentItems,
  updateContentItem,
  updateWorkflow,
} from "../db/workflowRepo.js";
import { tickAutopilot } from "./publicationScheduler.js";

function workflow(patch: Record<string, unknown> = {}) {
  const w = createWorkflow({
    name: "W", objective: "o", audience: "a", offer: "f",
    channels: ["x"], primaryMetric: "m", approvalPolicy: "each_item",
  });
  return Object.keys(patch).length ? updateWorkflow(w.id, patch)! : w;
}

function scheduled(workflowId: string, whenIso: string) {
  const item = createContentItem({
    workflowId, title: "t", body: "b", format: "social_post", channel: "x",
  });
  updateContentItem(item.id, { status: "scheduled", scheduledFor: whenIso });
  return item;
}

const PAST = "2020-01-01T00:00:00.000Z";
const NOW = "2030-01-01T00:00:00.000Z";

describe("scheduled publishing respects workflow status", () => {
  beforeEach(() => {
    db.exec("DELETE FROM content_items");
    db.exec("DELETE FROM workflows");
  });

  it("publishes due content for an active workflow", () => {
    const w = workflow({ status: "active" });
    scheduled(w.id, PAST);
    expect(listDueContentItems(NOW)).toHaveLength(1);
  });

  it("does NOT publish for a paused workflow", () => {
    const w = workflow({ status: "active" });
    scheduled(w.id, PAST);
    updateWorkflow(w.id, { status: "paused" });
    // Pausing is a statement that something is wrong. It has to stop the post.
    expect(listDueContentItems(NOW)).toHaveLength(0);
  });

  it("does NOT publish for completed or archived workflows", () => {
    for (const status of ["completed", "archived"] as const) {
      db.exec("DELETE FROM content_items");
      db.exec("DELETE FROM workflows");
      const w = workflow({ status: "active" });
      scheduled(w.id, PAST);
      updateWorkflow(w.id, { status });
      expect(listDueContentItems(NOW), status).toHaveLength(0);
    }
  });

  it("does NOT publish for a draft workflow that was never started", () => {
    const w = workflow();
    scheduled(w.id, PAST);
    expect(w.status).toBe("draft");
    expect(listDueContentItems(NOW)).toHaveLength(0);
  });

  it("resumes publishing when a paused workflow goes active again", () => {
    const w = workflow({ status: "active" });
    scheduled(w.id, PAST);
    updateWorkflow(w.id, { status: "paused" });
    expect(listDueContentItems(NOW)).toHaveLength(0);
    updateWorkflow(w.id, { status: "active" });
    expect(listDueContentItems(NOW)).toHaveLength(1);
  });
});

describe("autopilot", () => {
  beforeEach(() => {
    db.exec("DELETE FROM content_items");
    db.exec("DELETE FROM workflows");
    vi.restoreAllMocks();
  });

  function reviewItem(workflowId: string) {
    const item = createContentItem({
      workflowId, title: "t", body: "b", format: "social_post", channel: "x",
    });
    updateContentItem(item.id, { status: "review" });
    return item;
  }

  it("schedules nothing while autopilot is off", () => {
    const w = workflow({ status: "active" });
    reviewItem(w.id);
    expect(tickAutopilot(new Date(NOW))).toBe(0);
  });

  it("schedules approved content once switched on", () => {
    const w = workflow({ status: "active", autopilot: true });
    reviewItem(w.id);
    expect(tickAutopilot(new Date(NOW))).toBe(1);
  });

  it("spaces posts by the interval rather than stacking them", () => {
    const w = workflow({ status: "active", autopilot: true, autopilotIntervalHours: 24 });
    reviewItem(w.id);
    reviewItem(w.id);
    reviewItem(w.id);
    tickAutopilot(new Date(NOW));

    const times = listContentTimes(w.id);
    expect(times).toHaveLength(3);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    for (const gap of gaps) expect(gap).toBe(24 * 3_600_000);
  });

  it("ignores a paused workflow, so pausing stops scheduling too", () => {
    const w = workflow({ status: "paused", autopilot: true });
    reviewItem(w.id);
    expect(tickAutopilot(new Date(NOW))).toBe(0);
  });

  it("leaves drafts alone — a human still moves content to review", () => {
    const w = workflow({ status: "active", autopilot: true });
    createContentItem({ workflowId: w.id, title: "t", body: "b", format: "social_post", channel: "x" });
    expect(tickAutopilot(new Date(NOW))).toBe(0);
  });

  it("does not reschedule content it already scheduled", () => {
    const w = workflow({ status: "active", autopilot: true });
    reviewItem(w.id);
    expect(tickAutopilot(new Date(NOW))).toBe(1);
    expect(tickAutopilot(new Date(NOW))).toBe(0);
  });
});

function listContentTimes(workflowId: string): number[] {
  const rows = db
    .prepare(`SELECT scheduled_for FROM content_items WHERE workflow_id = ? AND scheduled_for IS NOT NULL`)
    .all(workflowId) as unknown as Array<{ scheduled_for: string }>;
  return rows.map((r) => Date.parse(r.scheduled_for)).sort((a, b) => a - b);
}
