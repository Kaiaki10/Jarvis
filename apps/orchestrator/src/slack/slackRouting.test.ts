import { describe, expect, it } from "vitest";
import type { AgentRecord } from "@jarvis/shared";
import { parseSlackUserIds, routeSlackMessage, stripSlackMentions } from "./slackRouting.js";

function agent(id: string, name: string): AgentRecord {
  return {
    id, name, role: "Specialist", systemPrompt: "", cwd: "", avatar: name[0], color: "accent",
    permissionMode: "default", allowedTools: null, chatSessionId: null, status: "active",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const agents = [agent("jarvis", "Jarvis"), agent("growth", "Growth Lead")];

describe("Slack agent routing", () => {
  it("removes Slack mentions without joining surrounding words", () => {
    expect(stripSlackMentions("<@U123>   review this")).toBe("review this");
  });

  it("keeps the agent already bound to the Slack thread", () => {
    const result = routeSlackMessage("continue the plan", agents, "growth", "jarvis");
    expect(result.agent?.id).toBe("growth");
    expect(result.explicit).toBe(false);
  });

  it("routes an explicit name and strips the directive", () => {
    const result = routeSlackMessage("Growth Lead: draft three posts", agents, "jarvis", "jarvis");
    expect(result.agent?.id).toBe("growth");
    expect(result.text).toBe("draft three posts");
    expect(result.explicit).toBe(true);
  });

  it("supports the readable agent prefix", () => {
    const result = routeSlackMessage("agent Growth Lead create a campaign", agents, undefined, "jarvis");
    expect(result.agent?.id).toBe("growth");
    expect(result.text).toBe("create a campaign");
  });

  it("parses comma and whitespace separated allowlists", () => {
    expect([...parseSlackUserIds("U1, U2\nU3")]).toEqual(["U1", "U2", "U3"]);
  });
});
