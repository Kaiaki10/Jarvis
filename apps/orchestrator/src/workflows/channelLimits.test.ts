import { describe, expect, it } from "vitest";
import { CHANNEL_BODY_LIMITS, type WorkflowRecord } from "@jarvis/shared";
import { workflowGenerationPrompt } from "./contentGeneration.js";
import { contentPublishingReadiness } from "./publicationService.js";

const workflow = {
  id: "w1", name: "W", objective: "o", audience: "a", offer: "f",
  channels: ["x"], primaryMetric: "m",
} as unknown as WorkflowRecord;

function prompt(channels: Array<"x" | "blog">) {
  return workflowGenerationPrompt({
    campaign: workflow, count: 2, formats: ["social_post"], channels, 
  });
}

describe("channel body limits", () => {
  it("states X's limit numerically in the generation prompt", () => {
    const p = prompt(["x"]);
    expect(p).toMatch(/HARD LIMIT: x bodies must be 280 characters or fewer/);
  });

  it("warns that the disclosure counts toward the limit", () => {
    // A character sheet appends a disclosure line to every post, and it is not
    // free — on X it is a meaningful slice of the 280.
    expect(prompt(["x"])).toMatch(/including any disclosure line/);
  });

  it("says nothing about limits for a channel that has none", () => {
    expect(prompt(["blog"])).not.toMatch(/HARD LIMIT/);
  });

  it("uses the same number the publish gate enforces", () => {
    const over = "x".repeat(CHANNEL_BODY_LIMITS.x! + 1);
    const readiness = contentPublishingReadiness({
      id: "i1", workflowId: "w1", title: "t", body: over,
      format: "social_post", channel: "x", status: "review",
      scheduledFor: null, publishedAt: null, performanceSummary: null,
      sessionId: null, createdAt: "", updatedAt: "",
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toMatch(/280 characters or fewer/);
  });

  it("accepts a body exactly at the limit", () => {
    const exact = "x".repeat(CHANNEL_BODY_LIMITS.x!);
    const readiness = contentPublishingReadiness({
      id: "i1", workflowId: "w1", title: "t", body: exact,
      format: "social_post", channel: "x", status: "review",
      scheduledFor: null, publishedAt: null, performanceSummary: null,
      sessionId: null, createdAt: "", updatedAt: "",
    });
    // Not "ready" here only because no account is attached — the length passed.
    expect(readiness.reason ?? "").not.toMatch(/characters or fewer/);
  });
});
