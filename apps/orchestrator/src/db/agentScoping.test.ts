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
    setAgentChatSessionId(frank.id, "session-frank-sol", "gpt-5.6-sol");
    expect(getAgentChatSessionId(frank.id, "gpt-5.6-sol")).toBe("session-frank-sol");
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

  it("stores Sol as a separate resumable model conversation", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createSession, deleteSession, getAgentChatSessionId, setAgentChatSessionId } =
      await import("./repo.js");
    const agent = createAgent({ name: "Model Switcher" });
    const session = createSession({
      title: "Sol chat", cwd: ".", permissionMode: "default", agentId: agent.id,
      model: "gpt-5.6-sol",
    });

    expect(session.model).toBe("gpt-5.6-sol");
    expect(session.codexThreadId).toBeNull();
    setAgentChatSessionId(agent.id, session.id, "gpt-5.6-sol");
    expect(getAgentChatSessionId(agent.id, "gpt-5.6-sol")).toBe(session.id);
    expect(getAgentChatSessionId(agent.id, "claude")).toBeNull();

    deleteSession(session.id);
    expect(getAgentChatSessionId(agent.id, "gpt-5.6-sol")).toBeNull();
  });

  it("isolates marketing, growth, customers, evolution, and notifications with their children", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { createCampaign, createContentItem, listCampaigns, listContentItems } = await import("./campaignRepo.js");
    const { createPaidGrowthCampaign, listPaidGrowthCampaigns } = await import("./paidGrowthRepo.js");
    const { createCustomerConversation, listCustomerOperations } = await import("./customerRepo.js");
    const { createEvolutionProposal, listEvolutionProposals } = await import("./repo.js");
    const { notify, listNotifications, markAllRead, unreadCount } = await import("../notifications/notifier.js");
    const ivy = createAgent({ name: "Ivy" });
    const jude = createAgent({ name: "Jude" });

    const ivyCampaign = createCampaign({ name: "Ivy launch", objective: "Grow", audience: "Teams", offer: "Demo", channels: ["blog"], primaryMetric: "leads", approvalPolicy: "campaign", agentId: ivy.id });
    const judeCampaign = createCampaign({ name: "Jude launch", objective: "Sell", audience: "Founders", offer: "Trial", channels: ["email"], primaryMetric: "trials", approvalPolicy: "each_item", agentId: jude.id });
    createContentItem({ campaignId: ivyCampaign.id, title: "Ivy article", body: "Body", format: "article", channel: "blog" });
    createContentItem({ campaignId: judeCampaign.id, title: "Jude email", body: "Body", format: "email", channel: "email" });
    createPaidGrowthCampaign({ name: "Ivy ads", objective: "Leads", platform: "google_ads", currency: "USD", dailyBudgetMinor: 100, lifetimeBudgetMinor: 1000, startDate: "2026-08-19", agentId: ivy.id });
    createPaidGrowthCampaign({ name: "Jude ads", objective: "Trials", platform: "meta_ads", currency: "USD", dailyBudgetMinor: 200, lifetimeBudgetMinor: 2000, startDate: "2026-08-19", agentId: jude.id });
    createCustomerConversation({ customerName: "Ivy Customer", customerEmail: "same@example.com", channel: "email", subject: "Ivy", message: "Hello", agentId: ivy.id });
    createCustomerConversation({ customerName: "Jude Customer", customerEmail: "same@example.com", channel: "email", subject: "Jude", message: "Hello", agentId: jude.id });
    createEvolutionProposal({ title: "Ivy idea", problem: "P", expectedValue: "V", changeClass: "product", risk: "low", agentId: ivy.id });
    createEvolutionProposal({ title: "Jude idea", problem: "P", expectedValue: "V", changeClass: "behavior", risk: "medium", agentId: jude.id });
    notify({ type: "session_failed", severity: "error", title: "Ivy alert", body: "Ivy only", agentId: ivy.id });
    notify({ type: "session_failed", severity: "error", title: "Jude alert", body: "Jude only", agentId: jude.id });

    expect(listCampaigns(ivy.id).map((item) => item.name)).toEqual(["Ivy launch"]);
    expect(listContentItems(undefined, ivy.id).map((item) => item.title)).toEqual(["Ivy article"]);
    expect(listPaidGrowthCampaigns(ivy.id).map((item) => item.name)).toEqual(["Ivy ads"]);
    expect(listCustomerOperations(ivy.id).customers.map((item) => item.name)).toEqual(["Ivy Customer"]);
    expect(listCustomerOperations(ivy.id).messages).toHaveLength(1);
    expect(listEvolutionProposals(ivy.id).map((item) => item.title)).toEqual(["Ivy idea"]);
    expect(listNotifications(100, ivy.id).map((item) => item.title)).toEqual(["Ivy alert"]);
    expect(unreadCount(jude.id)).toBe(1);
    markAllRead(ivy.id);
    expect(unreadCount(ivy.id)).toBe(0);
    expect(unreadCount(jude.id)).toBe(1);
  });
});
