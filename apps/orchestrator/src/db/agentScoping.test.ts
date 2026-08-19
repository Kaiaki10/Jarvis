import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.JARVIS_DB_PATH = join(mkdtempSync(join(tmpdir(), "jarvis-scope-")), "test.db");
});

/**
 * Full isolation is the promise of v2: two agents share a database but never
 * each other's work. These check the boundary at the repo layer, where it is
 * actually enforced — a UI that merely filters would look identical until the
 * day something queried without a filter.
 */
describe("agent scoping", () => {
  it("keeps sessions, tasks, missions, and automations apart", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const {
      createSession, listSessions,
      createTask, listTasks,
      createMission, listMissions,
      createScheduledTask, listScheduledTasks,
    } = await import("./repo.js");

    const alice = createAgent({ name: "Alice" });
    const bob = createAgent({ name: "Bob" });

    createSession({ title: "alice run", cwd: ".", permissionMode: "default", agentId: alice.id });
    createSession({ title: "bob run", cwd: ".", permissionMode: "default", agentId: bob.id });
    createTask({ title: "alice task", agentId: alice.id });
    createTask({ title: "bob task", agentId: bob.id });
    createMission({ title: "alice mission", outcome: "x", agentId: alice.id });
    createMission({ title: "bob mission", outcome: "y", agentId: bob.id });
    createScheduledTask({
      prompt: "alice automation", cwd: ".", permissionMode: "default",
      timeOfDay: "06:00", daysOfWeek: [1], nextRunAt: new Date().toISOString(),
      agentId: alice.id,
    });
    createScheduledTask({
      prompt: "bob automation", cwd: ".", permissionMode: "default",
      timeOfDay: "07:00", daysOfWeek: [1], nextRunAt: new Date().toISOString(),
      agentId: bob.id,
    });

    expect(listSessions(alice.id).map((s) => s.title)).toEqual(["alice run"]);
    expect(listTasks(alice.id).map((t) => t.title)).toEqual(["alice task"]);
    expect(listMissions(alice.id).map((m) => m.title)).toEqual(["alice mission"]);
    expect(listScheduledTasks(alice.id).map((t) => t.prompt)).toEqual(["alice automation"]);

    expect(listSessions(bob.id).map((s) => s.title)).toEqual(["bob run"]);
    expect(listTasks(bob.id).map((t) => t.title)).toEqual(["bob task"]);
  });

  it("returns every agent's rows when no agent is given", async () => {
    const { listSessions, listTasks } = await import("./repo.js");
    // The scheduler and maintenance jobs rely on this: they operate across the
    // whole system and must not silently see one agent's slice.
    expect(listSessions().length).toBeGreaterThanOrEqual(2);
    expect(listTasks().length).toBeGreaterThanOrEqual(2);
  });

  it("stamps the owning agent onto the record it returns", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createSession, getSession } = await import("./repo.js");
    const carol = createAgent({ name: "Carol" });

    const session = createSession({
      title: "carol run", cwd: ".", permissionMode: "default", agentId: carol.id,
    });
    expect(session.agentId).toBe(carol.id);
    expect(getSession(session.id)?.agentId).toBe(carol.id);
  });

  it("numbers each agent's task board independently", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createTask } = await import("./repo.js");
    const dave = createAgent({ name: "Dave" });
    const erin = createAgent({ name: "Erin" });

    createTask({ title: "d1", agentId: dave.id });
    createTask({ title: "d2", agentId: dave.id });
    const firstForErin = createTask({ title: "e1", agentId: erin.id });

    // A new agent's board starts at 1, rather than inheriting whatever number
    // the busiest agent has reached.
    expect(firstForErin.position).toBe(1);
  });

  it("gives each agent its own chat thread", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { getAgentChatSessionId, setAgentChatSessionId } = await import("./repo.js");
    const frank = createAgent({ name: "Frank" });
    const grace = createAgent({ name: "Grace" });

    expect(getAgentChatSessionId(frank.id)).toBeNull();
    setAgentChatSessionId(frank.id, "session-frank");

    expect(getAgentChatSessionId(frank.id)).toBe("session-frank");
    // The whole point of replacing settings.primary_session_id: one agent's
    // conversation must not become another's.
    expect(getAgentChatSessionId(grace.id)).toBeNull();
  });

  it("clears a deleted session from the agent that held it as its thread", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createSession, deleteSession, getAgentChatSessionId, setAgentChatSessionId } =
      await import("./repo.js");
    const heidi = createAgent({ name: "Heidi" });
    const session = createSession({
      title: "heidi chat", cwd: ".", permissionMode: "default", agentId: heidi.id,
    });
    setAgentChatSessionId(heidi.id, session.id);

    deleteSession(session.id);
    // A dangling pointer here would make the agent's chat load a session that
    // no longer exists, which reads as the conversation having vanished.
    expect(getAgentChatSessionId(heidi.id)).toBeNull();
  });
});
