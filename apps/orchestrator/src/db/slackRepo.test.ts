import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDefaultAgent } from "./agentRepo.js";
import { bindSlackThread, claimSlackEvent, getSlackThreadBinding } from "./slackRepo.js";

describe("Slack persistence", () => {
  it("claims a Slack event only once", () => {
    const workspace = `T-${randomUUID()}`;
    const event = `Ev-${randomUUID()}`;
    expect(claimSlackEvent(workspace, event, "hash-one")).toBe(true);
    expect(claimSlackEvent(workspace, event, "hash-one")).toBe(false);
  });

  it("persists a Slack thread's selected agent", () => {
    const jarvis = getDefaultAgent()!;
    const workspaceId = `T-${randomUUID()}`;
    const channelId = `C-${randomUUID()}`;
    const externalThreadId = `thread-${randomUUID()}`;
    bindSlackThread({ workspaceId, channelId, externalThreadId, agentId: jarvis.id, userId: "U123" });
    expect(getSlackThreadBinding(workspaceId, channelId, externalThreadId)).toMatchObject({
      agentId: jarvis.id,
      userId: "U123",
    });
  });
});
