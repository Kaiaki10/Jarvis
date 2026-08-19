import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.JARVIS_DB_PATH = join(mkdtempSync(join(tmpdir(), "jarvis-rooms-")), "test.db");
});

async function twoAgents() {
  const { createAgent } = await import("./agentRepo.js");
  return [createAgent({ name: `A${Math.random()}` }), createAgent({ name: `B${Math.random()}` })];
}

describe("conversationRepo", () => {
  it("creates a room with ordered participants and safe defaults", async () => {
    const [a, b] = await twoAgents();
    const { createConversation, listParticipants } = await import("./conversationRepo.js");

    const room = createConversation({ title: "Pricing", topic: "What should we charge?", agentIds: [a.id, b.id] });

    expect(room.status).toBe("idle");
    expect(room.turnsUsed).toBe(0);
    // Defaults must be bounded, not unlimited: an unbounded room is the way
    // this feature burns a night of quota.
    expect(room.turnCap).toBeGreaterThan(0);
    expect(room.budgetSeconds).toBeGreaterThan(0);

    const participants = listParticipants(room.id);
    expect(participants.map((p) => p.agentId)).toEqual([a.id, b.id]);
    expect(participants.map((p) => p.position)).toEqual([0, 1]);
  });

  it("honours explicit caps", async () => {
    const [a, b] = await twoAgents();
    const { createConversation } = await import("./conversationRepo.js");
    const room = createConversation({
      title: "Short", topic: "Be brief", agentIds: [a.id, b.id], turnCap: 3, budgetSeconds: 120,
    });
    expect(room.turnCap).toBe(3);
    expect(room.budgetSeconds).toBe(120);
  });

  it("keeps the transcript in turn order with speakers attributed", async () => {
    const [a, b] = await twoAgents();
    const { createConversation, appendConversationMessage, listConversationMessages } =
      await import("./conversationRepo.js");
    const room = createConversation({ title: "Order", topic: "t", agentIds: [a.id, b.id] });

    appendConversationMessage({ conversationId: room.id, turn: 1, speakerAgentId: a.id, speakerName: "A", body: "first" });
    appendConversationMessage({ conversationId: room.id, turn: 2, speakerAgentId: b.id, speakerName: "B", body: "second" });
    // A human interjection has no agent, which is what marks it as the human.
    appendConversationMessage({ conversationId: room.id, turn: 2, speakerAgentId: null, speakerName: "You", body: "wait" });

    const messages = listConversationMessages(room.id);
    expect(messages.map((m) => m.body)).toEqual(["first", "second", "wait"]);
    expect(messages[2].speakerAgentId).toBeNull();
  });

  it("removes participants and messages with the room", async () => {
    const [a, b] = await twoAgents();
    const { createConversation, appendConversationMessage, deleteConversation, listConversationMessages, listParticipants } =
      await import("./conversationRepo.js");
    const room = createConversation({ title: "Doomed", topic: "t", agentIds: [a.id, b.id] });
    appendConversationMessage({ conversationId: room.id, turn: 1, speakerAgentId: a.id, speakerName: "A", body: "hi" });

    deleteConversation(room.id);

    // Orphaned transcripts would accumulate invisibly, exactly the growth
    // problem session_events already had once.
    expect(listConversationMessages(room.id)).toEqual([]);
    expect(listParticipants(room.id)).toEqual([]);
  });

  it("records why a room ended", async () => {
    const [a, b] = await twoAgents();
    const { createConversation, updateConversation } = await import("./conversationRepo.js");
    const room = createConversation({ title: "Ended", topic: "t", agentIds: [a.id, b.id] });

    const ended = updateConversation(room.id, {
      status: "completed", endedAt: "2026-01-01T00:00:00.000Z", stopReason: "Reached the turn limit of 12.",
    });
    // A finished room has to explain itself, or a stopped conversation is
    // indistinguishable from a broken one.
    expect(ended?.status).toBe("completed");
    expect(ended?.stopReason).toContain("turn limit");
  });

  it("refuses to run a room with fewer than two agents", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const solo = createAgent({ name: "Solo" });
    const { createConversation, getConversation } = await import("./conversationRepo.js");
    const { runConversation } = await import("../conversations/conversationRunner.js");

    const room = createConversation({ title: "Alone", topic: "t", agentIds: [solo.id] });
    await runConversation(room.id);

    const after = getConversation(room.id);
    expect(after?.status).toBe("error");
    expect(after?.stopReason).toContain("at least two agents");
  });

  // Note: that a stop mid-turn reports as "stopped" rather than "error" is not
  // unit-tested — the branch needs a turn genuinely in flight, and staging one
  // would mock away the very interaction under test. It is verified live
  // against two real agents instead.

  it("stops a room on request and says so", async () => {
    const [a, b] = await twoAgents();
    const { createConversation, getConversation } = await import("./conversationRepo.js");
    const { stopConversation } = await import("../conversations/conversationRunner.js");

    const room = createConversation({ title: "Stoppable", topic: "t", agentIds: [a.id, b.id] });
    await stopConversation(room.id);

    const after = getConversation(room.id);
    expect(after?.status).toBe("stopped");
    expect(after?.endedAt).not.toBeNull();
    expect(after?.stopReason).toContain("Stopped by you");
  });
});
