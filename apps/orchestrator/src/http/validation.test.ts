import { describe, expect, it } from "vitest";
import {
  createScheduledTaskSchema,
  createSessionSchema,
  updateSettingsSchema,
  createMissionSchema,
  updateDeliverableSchema,
  createEvolutionProposalSchema,
  updateEvolutionPolicySchema,
  createPaidGrowthCampaignSchema,
  updatePaidGrowthPerformanceSchema,
} from "./validation.js";

describe("HTTP validation", () => {
  it("rejects permission modes that could bypass approval", () => {
    expect(
      createSessionSchema.safeParse({
        prompt: "post this",
        cwd: "C:\\work",
        permissionMode: "bypassPermissions",
      }).success
    ).toBe(false);
  });

  it("rejects caller-preapproved Jarvis platform tools", () => {
    expect(
      createSessionSchema.safeParse({
        prompt: "post this",
        cwd: "C:\\work",
        allowedTools: ["mcp__jarvis__post_to_x"],
      }).success
    ).toBe(false);
  });

  it("accepts a valid weekly schedule", () => {
    expect(
      createScheduledTaskSchema.safeParse({
        prompt: "review gaps",
        cwd: "C:\\work",
        timeOfDay: "08:30",
        daysOfWeek: [1, 3, 5],
      }).success
    ).toBe(true);
  });

  it.each(["8:30", "24:00", "12:60", "later"])("rejects invalid time %s", (time) => {
    expect(
      createScheduledTaskSchema.safeParse({
        prompt: "review gaps",
        cwd: "C:\\work",
        timeOfDay: time,
        daysOfWeek: [1],
      }).success
    ).toBe(false);
  });

  it("rejects duplicate and out-of-range weekdays", () => {
    for (const daysOfWeek of [[1, 1], [-1], [7]]) {
      expect(
        createScheduledTaskSchema.safeParse({
          prompt: "review gaps",
          cwd: "C:\\work",
          timeOfDay: "08:30",
          daysOfWeek,
        }).success
      ).toBe(false);
    }
  });

  it("bounds retention and action-cap settings", () => {
    expect(updateSettingsSchema.safeParse({ eventRetentionDays: -1 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ dailyPlatformActionCap: 10_001 }).success).toBe(false);
  });

  it("requires a concrete mission outcome and a real date shape", () => {
    expect(createMissionSchema.safeParse({ title: "Launch", outcome: "The site is live", targetDate: "2026-09-01" }).success).toBe(true);
    expect(createMissionSchema.safeParse({ title: "Launch", outcome: "" }).success).toBe(false);
    expect(createMissionSchema.safeParse({ title: "Launch", outcome: "Done", targetDate: "next week" }).success).toBe(false);
  });

  it("restricts deliverables to the review workflow", () => {
    expect(updateDeliverableSchema.safeParse({ status: "approved" }).success).toBe(true);
    expect(updateDeliverableSchema.safeParse({ status: "published" }).success).toBe(false);
  });

  it("validates evolution proposals and autonomy values", () => {
    expect(createEvolutionProposalSchema.safeParse({
      title: "Improve approvals",
      problem: "The scope is unclear",
      expectedValue: "People decide faster",
      changeClass: "product",
      risk: "medium",
    }).success).toBe(true);
    expect(createEvolutionProposalSchema.safeParse({
      title: "Improve approvals",
      problem: "",
      expectedValue: "People decide faster",
      changeClass: "unknown",
      risk: "medium",
    }).success).toBe(false);
    expect(updateEvolutionPolicySchema.safeParse({ autonomy: "approval_required" }).success).toBe(true);
    expect(updateEvolutionPolicySchema.safeParse({ autonomy: "unlimited" }).success).toBe(false);
  });

  it("bounds paid budgets and cumulative performance", () => {
    expect(createPaidGrowthCampaignSchema.safeParse({
      name: "Acquisition",
      objective: "Acquire customers",
      platform: "google_ads",
      externalCampaignId: "123456789",
      currency: "USD",
      dailyBudgetMinor: 2_500,
      lifetimeBudgetMinor: 50_000,
      targetRoas: 2,
      startDate: "2026-08-18",
    }).success).toBe(true);
    expect(createPaidGrowthCampaignSchema.safeParse({
      name: "Bad Google ID",
      objective: "Reject malformed identifiers",
      platform: "google_ads",
      externalCampaignId: "campaign'; DROP TABLE",
      currency: "USD",
      dailyBudgetMinor: 1_000,
      lifetimeBudgetMinor: 10_000,
      startDate: "2026-08-18",
    }).success).toBe(false);
    expect(createPaidGrowthCampaignSchema.safeParse({
      name: "Invalid",
      objective: "Overspend",
      platform: "unknown",
      currency: "usd",
      dailyBudgetMinor: 5_000,
      lifetimeBudgetMinor: 1_000,
      startDate: "today",
    }).success).toBe(false);
    expect(updatePaidGrowthPerformanceSchema.safeParse({
      spentMinor: 1_000,
      revenueMinor: 2_000,
      impressions: 100,
      clicks: 20,
      conversions: 30,
    }).success).toBe(false);
  });
});
