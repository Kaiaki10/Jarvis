import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { StoreProvider, useStore } from "./store";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<() => void>>();

  constructor(public readonly url: string | URL) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  emit(name: string) {
    for (const listener of this.listeners.get(name) ?? []) listener();
  }
  /** Delivers a payload, for listeners that parse event.data. */
  emitData(name: string, data: unknown) {
    for (const listener of this.listeners.get(name) ?? []) {
      (listener as unknown as (e: MessageEvent) => void)({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
  close() {}
}

function mockInitialRequests() {
  vi.spyOn(api, "getSettings").mockResolvedValue({} as never);
  vi.spyOn(api, "listPlatforms").mockResolvedValue([]);
  vi.spyOn(api, "listConnections").mockResolvedValue([]);
  vi.spyOn(api, "listNotifications").mockResolvedValue({ items: [], unread: 0 });
  vi.spyOn(api, "listSessions").mockResolvedValue([]);
  vi.spyOn(api, "listTasks").mockResolvedValue([]);
  vi.spyOn(api, "listMissions").mockResolvedValue([]);
  vi.spyOn(api, "listDeliverables").mockResolvedValue([]);
  vi.spyOn(api, "listMissionUpdates").mockResolvedValue([]);
  vi.spyOn(api, "getWorkflows").mockResolvedValue({ workflows: [], content: [], generationRuns: [], publicationRuns: [], accounts: [], metricCounts: {}, insightCounts: {}, adCampaignCounts: {} });
  vi.spyOn(api, "getCustomerOperations").mockResolvedValue({
    customers: [], conversations: [], messages: [], drafts: [], deliveries: [],
    policy: {
      enabled: false, autoReplyWebsite: true, autoReplyEmail: false, autoReplySocial: false,
      confidenceThreshold: 0.9, maxAutoRepliesPerConversation: 3,
      businessHoursStart: "08:00", businessHoursEnd: "18:00", businessDays: [1, 2, 3, 4, 5],
      escalationKeywords: ["refund"], widgetName: "Jarvis Support", widgetWelcome: "Hi — how can we help?",
      allowedOrigins: [], updatedAt: null,
    },
  });
  vi.spyOn(api, "getPaidGrowth").mockResolvedValue({
    campaigns: [], decisions: [], totals: {
      currency: "USD", approvedBudgetMinor: 0, spentMinor: 0,
      revenueMinor: 0, active: 0, waitingApproval: 0,
    },
  });
  vi.spyOn(api, "listMemories").mockResolvedValue([]);
  vi.spyOn(api, "listMemoryReflections").mockResolvedValue([]);
  vi.spyOn(api, "listScheduledTasks").mockResolvedValue([]);
  vi.spyOn(api, "getJarvis").mockResolvedValue({ id: "jarvis", name: "Jarvis" } as never);
  vi.spyOn(api, "getChat").mockResolvedValue({ session: null });
}

/**
 * The stream URL is built by fetching the orchestrator token from this app's
 * own server, so the provider cannot open an EventSource without it. Stubbing
 * fetch rather than the URL builder keeps that path under test.
 */
const TEST_TOKEN = "test-token-value";

function mockTokenEndpoint() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/token")) {
        return new Response(JSON.stringify({ token: TEST_TOKEN }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    })
  );
}

describe("StoreProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    FakeEventSource.instances = [];
  });

  it("owns exactly one global EventSource", async () => {
    mockInitialRequests();
    mockTokenEndpoint();
    vi.stubGlobal("EventSource", FakeEventSource);

    render(
      <StoreProvider>
        <div>ready</div>
      </StoreProvider>
    );

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(String(FakeEventSource.instances[0].url)).toContain("/events");
    // EventSource cannot send an Authorization header, so an unauthenticated
    // stream would be rejected by the orchestrator and the app would look dead.
    expect(String(FakeEventSource.instances[0].url)).toContain(`token=${TEST_TOKEN}`);

    FakeEventSource.instances[0].emit("open");
    await waitFor(() => expect(api.listSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listScheduledTasks).toHaveBeenCalledTimes(1));
    expect(FakeEventSource.instances).toHaveLength(1);

    await waitFor(() => expect(api.listMissionUpdates).toHaveBeenCalled());
    const missionCalls = vi.mocked(api.listMissionUpdates).mock.calls.length;
    FakeEventSource.instances[0].emit("missions-changed");
    await waitFor(() => expect(vi.mocked(api.listMissionUpdates).mock.calls.length).toBeGreaterThan(missionCalls));
    expect(FakeEventSource.instances).toHaveLength(1);

    const campaignCalls = vi.mocked(api.getWorkflows).mock.calls.length;
    FakeEventSource.instances[0].emit("workflows-changed");
    await waitFor(() => expect(vi.mocked(api.getWorkflows).mock.calls.length).toBeGreaterThan(campaignCalls));
    expect(FakeEventSource.instances).toHaveLength(1);

    const automationCalls = vi.mocked(api.listScheduledTasks).mock.calls.length;
    FakeEventSource.instances[0].emit("automations-changed");
    await waitFor(() => expect(vi.mocked(api.listScheduledTasks).mock.calls.length).toBeGreaterThan(automationCalls));

    const chatCalls = vi.mocked(api.getChat).mock.calls.length;
    FakeEventSource.instances[0].emit("chat-changed");
    await waitFor(() => expect(vi.mocked(api.getChat).mock.calls.length).toBeGreaterThan(chatCalls));

    const customerCalls = vi.mocked(api.getCustomerOperations).mock.calls.length;
    FakeEventSource.instances[0].emit("customers-changed");
    await waitFor(() => expect(vi.mocked(api.getCustomerOperations).mock.calls.length).toBeGreaterThan(customerCalls));
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("loads Jarvis's record and refreshes it when it changes", async () => {
    mockInitialRequests();
    mockTokenEndpoint();
    vi.stubGlobal("EventSource", FakeEventSource);

    function Name() {
      const { jarvis } = useStore();
      return <div data-testid="name">{jarvis?.name ?? ""}</div>;
    }
    render(<StoreProvider><Name /></StoreProvider>);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].emit("open");
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Jarvis"));

    vi.mocked(api.getJarvis).mockResolvedValue({ id: "jarvis", name: "Friday" } as never);
    FakeEventSource.instances[0].emit("agents-changed");
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Friday"));
  });

  it("keeps every streamed session, whichever agent row owns it", async () => {
    mockInitialRequests();
    mockTokenEndpoint();
    vi.stubGlobal("EventSource", FakeEventSource);

    function Runs() {
      const { sessions } = useStore();
      return <div data-testid="runs">{sessions.map((s) => s.title).join("|")}</div>;
    }
    render(<StoreProvider><Runs /></StoreProvider>);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.instances[0].emitData("session-updated", {
      id: "s1", agentId: "jarvis", title: "jarvis run", status: "idle", updatedAt: "2026-01-02",
    });
    FakeEventSource.instances[0].emitData("session-updated", {
      id: "s2", agentId: "legacy", title: "legacy run", status: "idle", updatedAt: "2026-01-03",
    });

    await waitFor(() => expect(screen.getByTestId("runs").textContent).toContain("legacy run"));
    expect(screen.getByTestId("runs").textContent).toContain("jarvis run");
  });
});
