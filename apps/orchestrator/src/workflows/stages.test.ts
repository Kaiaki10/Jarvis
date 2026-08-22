import { describe, expect, it } from "vitest";
import { workflowStages, type WorkflowStageInput } from "@jarvis/shared";

function input(patch: Partial<WorkflowStageInput> = {}): WorkflowStageInput {
  return {
    accounts: [],
    content: [],
    publicationRuns: [],
    metricCount: 0,
    adCampaigns: 0,
    adPlatformConnected: false,
    insightCount: 0,
    ...patch,
  };
}

const account = (patch: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    agentId: null,
    label: null,
    platformId: "x",
    status: "connected",
    detail: null,
    errorMessage: null,
    fieldHints: {},
    lastTestedAt: null,
    updatedAt: "",
    ...patch,
  }) as WorkflowStageInput["accounts"][number];

const run = (status: string) =>
  ({
    id: "r1",
    contentItemId: "i1",
    sessionId: "s1",
    platformId: "x",
    status,
    errorMessage: null,
    createdAt: "",
    completedAt: null,
  }) as WorkflowStageInput["publicationRuns"][number];

const item = () => ({ id: "i1" }) as WorkflowStageInput["content"][number];

function stage(key: string, i: WorkflowStageInput) {
  return workflowStages(i).find((s) => s.key === key)!;
}

describe("workflowStages", () => {
  it("numbers all five stages in order", () => {
    expect(workflowStages(input()).map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("asks for an account before one is attached", () => {
    expect(stage("accounts", input()).state).toBe("ready");
  });

  it("does not count an attached account that is not connected", () => {
    const s = stage("accounts", input({ accounts: [account({ status: "error" })] }));
    expect(s.state).toBe("ready");
    expect(s.detail).toMatch(/none are connected/i);
  });

  it("names the connected accounts once attached", () => {
    const s = stage("accounts", input({ accounts: [account({ label: "@acme" })] }));
    expect(s.state).toBe("done");
    expect(s.detail).toBe("@acme");
  });

  it("treats content as done regardless of accounts, since drafting needs none", () => {
    const s = stage("content", input({ content: [item()] }));
    expect(s.state).toBe("done");
  });

  it("blocks metrics until something is actually published", () => {
    const s = stage("metrics", input({ content: [item()] }));
    expect(s.state).toBe("blocked");
    expect(s.detail).toBe("Needs a published post");
  });

  it("does not treat a failed publication as measurable", () => {
    const s = stage("metrics", input({ content: [item()], publicationRuns: [run("failed")] }));
    expect(s.state).toBe("blocked");
  });

  it("becomes ready to measure once a post is genuinely published", () => {
    const s = stage("metrics", input({ content: [item()], publicationRuns: [run("published")] }));
    expect(s.state).toBe("ready");
    expect(s.detail).toMatch(/1 post ready to measure/);
  });

  it("blocks advertising when no ad platform is connected at all", () => {
    const s = stage("advertising", input());
    expect(s.state).toBe("blocked");
    expect(s.detail).toBe("No ad platform connected");
  });

  it("offers advertising once a platform exists to spend through", () => {
    expect(stage("advertising", input({ adPlatformConnected: true })).state).toBe("ready");
  });

  it("blocks learning until there is something measured to learn from", () => {
    const s = stage("learning", input({ content: [item()], publicationRuns: [run("published")] }));
    expect(s.state).toBe("blocked");
    expect(s.detail).toBe("Needs measured posts");
  });

  it("opens learning only once metrics exist", () => {
    expect(stage("learning", input({ metricCount: 4 })).state).toBe("ready");
  });

  it("recomputes rather than latching — removing the account undoes stage one", () => {
    const withAccount = stage("accounts", input({ accounts: [account()] }));
    expect(withAccount.state).toBe("done");
    // Same workflow, account since removed.
    expect(stage("accounts", input()).state).toBe("ready");
  });
});
