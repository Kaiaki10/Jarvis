"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentRecord,
  AgentConversationRecord,
  ConnectionRecord,
  NotificationRecord,
  PlatformDefinition,
  ScheduledTaskRecord,
  SessionRecord,
  SettingsRecord,
  TaskRecord,
  UpdateSettingsRequest,
  MissionRecord,
  DeliverableRecord,
  MissionUpdateRecord,
  EvolutionOverview,
  WorkflowOverview,
  MemoryRecord,
  MemoryReflectionRecord,
  CustomerOperationsOverview,
  PaidGrowthOverview,
  TrendsOverview,
  PlatformSignupProgress,
  SignupEmailEvent,
  ClaudeUsageSnapshot,
} from "@jarvis/shared";
import { api, globalEventsUrl, setActiveAgentId } from "./api";

export interface ActivityLogEntry {
  id: string;
  time: string;
  text: string;
}

interface StoreValue {
  connectionStatus: "connecting" | "connected" | "offline";
  agents: AgentRecord[];
  refreshAgents: () => Promise<void>;
  /** Whose workspace is on screen. Null only before the first agent list lands. */
  activeAgent: AgentRecord | null;
  selectAgent: (id: string) => void;
  conversations: AgentConversationRecord[];
  refreshConversations: () => Promise<void>;
  memories: MemoryRecord[];
  memoryReflections: MemoryReflectionRecord[];
  refreshMemories: () => Promise<void>;
  sessions: SessionRecord[];
  sessionsLoading: boolean;
  /** The ongoing conversation with Jarvis — kept out of the run history. */
  primarySessionId: string | null;
  removeSession: (id: string) => Promise<void>;
  sessionById: Map<string, SessionRecord>;
  activity: ActivityLogEntry[];
  tasks: TaskRecord[];
  refreshTasks: () => Promise<void>;
  missions: MissionRecord[];
  deliverables: DeliverableRecord[];
  missionUpdates: MissionUpdateRecord[];
  refreshMissions: () => Promise<void>;
  evolution: EvolutionOverview | null;
  refreshEvolution: () => Promise<void>;
  campaigns: WorkflowOverview | null;
  refreshWorkflows: () => Promise<void>;
  customerOperations: CustomerOperationsOverview | null;
  refreshCustomerOperations: () => Promise<void>;
  paidGrowth: PaidGrowthOverview | null;
  refreshPaidGrowth: () => Promise<void>;
  /** A derived, descriptive view over campaigns/customers/paid-growth — refreshed
   *  whenever any of those change rather than on its own SSE event. */
  trends: TrendsOverview | null;
  refreshTrends: () => Promise<void>;
  scheduledTasks: ScheduledTaskRecord[];
  refreshScheduledTasks: () => Promise<void>;
  settings: SettingsRecord | null;
  saveSettings: (patch: UpdateSettingsRequest) => Promise<void>;
  platforms: PlatformDefinition[];
  connections: ConnectionRecord[];
  refreshConnections: () => Promise<void>;
  /**
   * Signup-wizard state for whichever platform's connect page is open right
   * now — not agent-scoped and not preloaded like the rest of the store,
   * since it's only ever relevant on one Connections/[platformId] page at a
   * time. `loadPlatformSignup` both fetches and remembers which platform to
   * keep re-fetching when `platform-signup-changed` arrives; passing `null`
   * stops tracking (call on unmount).
   */
  platformSignup: { progress: PlatformSignupProgress | null; events: SignupEmailEvent[] } | null;
  loadPlatformSignup: (platformId: string | null) => Promise<void>;
  notifications: NotificationRecord[];
  unreadNotifications: number;
  refreshNotifications: () => Promise<void>;
  /** Null until the first session of this process reports a rate-limit window. */
  claudeUsage: ClaudeUsageSnapshot | null;
}

const StoreContext = createContext<StoreValue | null>(null);

/**
 * Which agent this browser is looking at. A view preference rather than server
 * state, so two tabs can sit on different agents without fighting each other.
 */
export const SELECTED_AGENT_KEY = "jarvis.selectedAgentId";

const ACTIVITY_LIMIT = 30;

function toActivityEntry(session: SessionRecord): ActivityLogEntry {
  return {
    id: `${session.id}-${session.updatedAt}`,
    time: new Date(session.updatedAt).toLocaleTimeString([], { hour12: false }),
    text: `${session.title.slice(0, 44)} → ${session.status.replace("_", " ")}`,
  };
}

/**
 * Single source of live data for the whole app. Everything shares ONE
 * EventSource — browsers cap concurrent connections per origin (~6), so a
 * per-component EventSource would starve the app once several widgets mount.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "offline"
  >("connecting");
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  // Read synchronously so the very first request is already scoped, rather than
  // fetching the default agent's data and replacing it a moment later.
  const [activeAgentId, setActiveAgentIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(SELECTED_AGENT_KEY);
    if (stored) setActiveAgentId(stored);
    return stored;
  });
  /**
   * The SSE listeners are registered once and close over their initial state,
   * so they read the current agent through a ref rather than a stale capture.
   * Re-subscribing on every switch would tear down and rebuild the single
   * shared EventSource instead.
   */
  const activeAgentIdRef = useRef<string | null>(activeAgentId);
  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
  }, [activeAgentId]);

  const [conversations, setConversations] = useState<AgentConversationRecord[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [memoryReflections, setMemoryReflections] = useState<MemoryReflectionRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [primarySessionId, setPrimarySessionId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableRecord[]>([]);
  const [missionUpdates, setMissionUpdates] = useState<MissionUpdateRecord[]>([]);
  const [evolution, setEvolution] = useState<EvolutionOverview | null>(null);
  const [campaigns, setCampaigns] = useState<WorkflowOverview | null>(null);
  const [customerOperations, setCustomerOperations] = useState<CustomerOperationsOverview | null>(null);
  const [paidGrowth, setPaidGrowth] = useState<PaidGrowthOverview | null>(null);
  const [trends, setTrends] = useState<TrendsOverview | null>(null);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskRecord[]>([]);
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [platforms, setPlatforms] = useState<PlatformDefinition[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [platformSignup, setPlatformSignup] = useState<StoreValue["platformSignup"]>(null);
  const [claudeUsage, setClaudeUsage] = useState<ClaudeUsageSnapshot | null>(null);
  const trackedSignupPlatformId = useRef<string | null>(null);

  const refreshTasks = useCallback(async () => {
    setTasks(await api.listTasks());
  }, []);

  const refreshScheduledTasks = useCallback(async () => {
    setScheduledTasks(await api.listScheduledTasks());
  }, []);

  const refreshAgents = useCallback(async () => {
    const next = await api.listAgents();
    setAgents(next);

    // Adopt a selection if there is none, or if the stored one has been
    // archived or deleted — otherwise the dashboard would scope every request
    // to an agent that no longer exists and show a permanently empty workspace.
    //
    // Done synchronously, not inside a setState updater: React runs an updater
    // whenever it next renders, so awaiting this function did not guarantee the
    // request scope had actually moved. The first scoped fetch then went out
    // against the previous agent.
    const current = activeAgentIdRef.current;
    const stillValid = current && next.some((a) => a.id === current && a.status === "active");
    if (stillValid) return;

    const fallback = next.find((a) => a.status === "active")?.id ?? null;
    activeAgentIdRef.current = fallback;
    setActiveAgentId(fallback);
    if (typeof window !== "undefined" && fallback) {
      window.localStorage.setItem(SELECTED_AGENT_KEY, fallback);
    }
    setActiveAgentIdState(fallback);
  }, []);

  const refreshConversations = useCallback(async () => {
    setConversations(await api.listConversations());
  }, []);

  const refreshMemories = useCallback(async () => {
    const [nextMemories, nextReflections] = await Promise.all([
      api.listMemories(),
      api.listMemoryReflections(),
    ]);
    setMemories(nextMemories);
    setMemoryReflections(nextReflections);
  }, []);

  const refreshMissions = useCallback(async () => {
    const [nextMissions, nextDeliverables, nextUpdates] = await Promise.all([
      api.listMissions(),
      api.listDeliverables(),
      api.listMissionUpdates(),
    ]);
    setMissions(nextMissions);
    setDeliverables(nextDeliverables);
    setMissionUpdates(nextUpdates);
  }, []);

  const refreshEvolution = useCallback(async () => {
    setEvolution(await api.getEvolution());
  }, []);

  const refreshWorkflows = useCallback(async () => {
    setCampaigns(await api.getWorkflows());
  }, []);

  const refreshCustomerOperations = useCallback(async () => {
    setCustomerOperations(await api.getCustomerOperations());
  }, []);

  const refreshPaidGrowth = useCallback(async () => {
    setPaidGrowth(await api.getPaidGrowth());
  }, []);

  const refreshTrends = useCallback(async () => {
    setTrends(await api.getTrends());
  }, []);

  const saveSettings = useCallback(async (patch: UpdateSettingsRequest) => {
    setSettings(await api.updateSettings(patch));
  }, []);

  const refreshConnections = useCallback(async () => {
    setConnections(await api.listConnections());
  }, []);

  const loadPlatformSignup = useCallback(async (platformId: string | null) => {
    trackedSignupPlatformId.current = platformId;
    if (!platformId) {
      setPlatformSignup(null);
      return;
    }
    setPlatformSignup(await api.getPlatformSignup(platformId));
  }, []);

  const refreshNotifications = useCallback(async () => {
    const { items, unread } = await api.listNotifications();
    setNotifications(items);
    setUnreadNotifications(unread);
  }, []);

  const refreshPrimaryChat = useCallback(async () => {
    const { session } = await api.getChat();
    setPrimarySessionId(session?.id ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let reconnectDelay = 1000;
    let currentSource: EventSource | null = null;

    async function connect() {
      if (cancelled) return;

      let url: string;
      try {
        url = await globalEventsUrl();
      } catch {
        // No token means no stream. Report offline and retry on the same backoff
        // as a dropped connection rather than failing silently forever.
        if (cancelled) return;
        setConnectionStatus("offline");
        setSessionsLoading(false);
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          void connect();
        }, reconnectDelay);
        return;
      }
      // The provider may have unmounted while the token was in flight.
      if (cancelled) return;

      const source = new EventSource(url);
      currentSource = source;

      source.addEventListener("session-updated", (evt) => {
        const updated = JSON.parse((evt as MessageEvent).data) as SessionRecord;

        // The stream carries every agent's sessions, because one connection
        // serves the whole app. Without this filter another agent's scheduled
        // runs append themselves to the list and the run history fills with
        // work the selected agent never did.
        const scopedTo = activeAgentIdRef.current;
        if (scopedTo && updated.agentId && updated.agentId !== scopedTo) return;

        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === updated.id);
          const next = idx === -1 ? [updated, ...prev] : [...prev];
          if (idx !== -1) next[idx] = updated;
          return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });

        setActivity((prev) => {
          const entry = toActivityEntry(updated);
          if (prev.some((e) => e.id === entry.id)) return prev;
          return [entry, ...prev].slice(0, ACTIVITY_LIMIT);
        });
      });

      source.addEventListener("notifications-changed", () => {
        refreshNotifications().catch(() => {});
      });

      // The payload is the whole snapshot, so this needs no follow-up fetch.
      source.addEventListener("claude-usage-changed", (evt) => {
        try {
          setClaudeUsage(JSON.parse((evt as MessageEvent).data) as ClaudeUsageSnapshot);
        } catch {
          // A malformed frame should leave the last good reading on screen
          // rather than blanking the indicator.
        }
      });

      source.addEventListener("missions-changed", () => {
        refreshMissions().catch(() => {});
        refreshTasks().catch(() => {});
      });

      source.addEventListener("evolution-changed", () => {
        refreshEvolution().catch(() => {});
      });

      source.addEventListener("workflows-changed", () => {
        refreshWorkflows().catch(() => {});
        refreshTrends().catch(() => {});
      });

      source.addEventListener("memories-changed", () => {
        refreshMemories().catch(() => {});
      });

      // Fires on every turn a room takes, which is what makes an agent
      // conversation watchable rather than something you refresh to follow.
      source.addEventListener("conversations-changed", () => {
        refreshConversations().catch(() => {});
      });

      source.addEventListener("agents-changed", () => {
        refreshAgents().catch(() => {});
      });

      // Only re-fetches if a signup page is actually open — see
      // loadPlatformSignup's comment on why this isn't preloaded like the
      // rest of the store.
      source.addEventListener("platform-signup-changed", () => {
        if (trackedSignupPlatformId.current) loadPlatformSignup(trackedSignupPlatformId.current).catch(() => {});
      });

      source.addEventListener("automations-changed", () => {
        refreshScheduledTasks().catch(() => {});
      });

      source.addEventListener("chat-changed", () => {
        refreshPrimaryChat().catch(() => {});
      });

      source.addEventListener("customers-changed", () => {
        refreshCustomerOperations().catch(() => {});
        refreshTrends().catch(() => {});
      });

      source.addEventListener("paid-growth-changed", () => {
        refreshPaidGrowth().catch(() => {});
        refreshTrends().catch(() => {});
      });

      source.addEventListener("open", () => {
        reconnectDelay = 1000;
        setConnectionStatus("connected");
        // SSE has no replay cursor for global events. Reload authoritative state
        // so updates that happened while disconnected cannot leave the UI stale.
        //
        // Agents are resolved FIRST and awaited, because everything below is
        // scoped to the active one. Fetching in parallel meant the first load
        // went out unscoped, pulled every agent's rows, and then adopted an
        // agent without reloading — so the dashboard opened showing one agent's
        // name over another agent's data.
        void refreshAgents()
          .catch(() => {})
          .then(() => Promise.allSettled([
          api.listSessions().then((initial) => {
            if (cancelled) return;
            setSessions(initial);
            setSessionsLoading(false);
            setActivity((prev) => {
              const seeded = initial.slice(0, ACTIVITY_LIMIT).map(toActivityEntry);
              const seen = new Set(prev.map((entry) => entry.id));
              return [...prev, ...seeded.filter((entry) => !seen.has(entry.id))].slice(
                0,
                ACTIVITY_LIMIT
              );
            });
          }),
          api.getSettings().then(setSettings),
          api.listPlatforms().then(setPlatforms),
          // Fetched once at mount, then kept current by the stream. Not part of
          // the agent-switch refresh — one Claude account serves every agent.
          api.getUsage().then(setClaudeUsage),
          refreshConnections(),
          refreshNotifications(),
          refreshTasks(),
          refreshMissions(),
          refreshScheduledTasks(),
          refreshEvolution(),
          refreshWorkflows(),
            refreshMemories(),
            refreshConversations(),
            refreshPrimaryChat(),
            refreshCustomerOperations(),
            refreshPaidGrowth(),
            refreshTrends(),
          ]));
      });

      source.onerror = () => {
        source.close();
        if (cancelled) return;
        setConnectionStatus("offline");
        setSessionsLoading(false);

        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          void connect();
        }, reconnectDelay);
      };
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (currentSource) currentSource.close();
    };
  }, [
    refreshWorkflows,
    refreshCustomerOperations,
    refreshPaidGrowth,
    refreshTrends,
    refreshConnections,
    refreshEvolution,
    refreshAgents,
    refreshConversations,
    refreshMemories,
    refreshMissions,
    refreshNotifications,
    refreshPrimaryChat,
    refreshScheduledTasks,
    refreshTasks,
    loadPlatformSignup,
  ]);

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) ?? null,
    [agents, activeAgentId]
  );

  /**
   * Switching agent replaces the whole workspace, so every scoped collection is
   * reloaded rather than left showing the previous agent's rows until something
   * happens to invalidate them.
   */
  const selectAgent = useCallback(
    (id: string) => {
      if (id === activeAgentId) return;
      // Same reason as in refreshAgents: the scope must move before the
      // requests below are issued, so it is set directly rather than awaited
      // through a render.
      activeAgentIdRef.current = id;
      setActiveAgentId(id);
      window.localStorage.setItem(SELECTED_AGENT_KEY, id);
      setActiveAgentIdState(id);
      void Promise.allSettled([
        api.listSessions().then(setSessions),
        refreshTasks(),
        refreshMissions(),
        refreshScheduledTasks(),
        refreshPrimaryChat(),
        refreshWorkflows(),
        refreshCustomerOperations(),
        refreshPaidGrowth(),
        refreshTrends(),
        refreshEvolution(),
        refreshMemories(),
        refreshNotifications(),
      ]);
    },
    [activeAgentId, refreshTasks, refreshMissions, refreshScheduledTasks, refreshPrimaryChat, refreshWorkflows, refreshCustomerOperations, refreshPaidGrowth, refreshTrends, refreshEvolution, refreshMemories, refreshNotifications]
  );

  const removeSession = useCallback(async (id: string) => {
    await api.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions]
  );

  const value = useMemo<StoreValue>(
    () => ({
      connectionStatus,
      agents,
      refreshAgents,
      activeAgent,
      selectAgent,
      conversations,
      refreshConversations,
      memories,
      memoryReflections,
      refreshMemories,
      sessions,
      sessionsLoading,
      primarySessionId,
      removeSession,
      sessionById,
      activity,
      tasks,
      refreshTasks,
      missions,
      deliverables,
      missionUpdates,
      refreshMissions,
      evolution,
      refreshEvolution,
      campaigns,
      refreshWorkflows,
      customerOperations,
      refreshCustomerOperations,
      paidGrowth,
      refreshPaidGrowth,
      trends,
      refreshTrends,
      scheduledTasks,
      refreshScheduledTasks,
      settings,
      saveSettings,
      platforms,
      connections,
      refreshConnections,
      platformSignup,
      loadPlatformSignup,
      notifications,
      unreadNotifications,
      refreshNotifications,
      claudeUsage,
    }),
    [
      connectionStatus,
      agents,
      refreshAgents,
      activeAgent,
      selectAgent,
      conversations,
      refreshConversations,
      memories,
      memoryReflections,
      refreshMemories,
      sessions,
      sessionsLoading,
      primarySessionId,
      removeSession,
      sessionById,
      activity,
      tasks,
      refreshTasks,
      missions,
      deliverables,
      missionUpdates,
      refreshMissions,
      evolution,
      refreshEvolution,
      campaigns,
      refreshWorkflows,
      customerOperations,
      refreshCustomerOperations,
      paidGrowth,
      refreshPaidGrowth,
      trends,
      refreshTrends,
      scheduledTasks,
      refreshScheduledTasks,
      settings,
      saveSettings,
      platforms,
      connections,
      refreshConnections,
      platformSignup,
      loadPlatformSignup,
      notifications,
      unreadNotifications,
      refreshNotifications,
      claudeUsage,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function useSessionsList() {
  const { sessions, sessionsLoading, sessionById, primarySessionId, removeSession } =
    useStore();
  return {
    sessions,
    loading: sessionsLoading,
    sessionById,
    primarySessionId,
    removeSession,
  };
}

export function useActivityLog() {
  return useStore().activity;
}

export function useTasksList() {
  const { tasks, refreshTasks } = useStore();
  return { tasks, refresh: refreshTasks };
}

export function useScheduledTasksList() {
  const { scheduledTasks, refreshScheduledTasks } = useStore();
  return { tasks: scheduledTasks, refresh: refreshScheduledTasks };
}

export function useSettings() {
  const { settings, saveSettings } = useStore();
  return { settings, saveSettings };
}

export function useConnections() {
  const { platforms, connections, refreshConnections } = useStore();
  return { platforms, connections, refresh: refreshConnections };
}

/** Loads on mount, stops tracking on unmount — see loadPlatformSignup's comment in StoreValue. */
export function usePlatformSignup(platformId: string | null) {
  const { platformSignup, loadPlatformSignup } = useStore();
  useEffect(() => {
    loadPlatformSignup(platformId).catch(() => {});
    return () => {
      loadPlatformSignup(null).catch(() => {});
    };
  }, [platformId, loadPlatformSignup]);
  return { progress: platformSignup?.progress ?? null, events: platformSignup?.events ?? [], refresh: () => loadPlatformSignup(platformId) };
}

export function useNotifications() {
  const { notifications, unreadNotifications, refreshNotifications } = useStore();
  return { notifications, unread: unreadNotifications, refresh: refreshNotifications };
}

export function useMissionsList() {
  const { missions, deliverables, missionUpdates, refreshMissions } = useStore();
  return { missions, deliverables, updates: missionUpdates, refresh: refreshMissions };
}

export function useEvolution() {
  const { evolution, refreshEvolution } = useStore();
  return { evolution, refresh: refreshEvolution };
}

export function useWorkflows() {
  const { campaigns, refreshWorkflows } = useStore();
  return { overview: campaigns, refresh: refreshWorkflows };
}

export function useCustomerOperations() {
  const { customerOperations, refreshCustomerOperations } = useStore();
  return { overview: customerOperations, refresh: refreshCustomerOperations };
}

export function usePaidGrowth() {
  const { paidGrowth, refreshPaidGrowth } = useStore();
  return { overview: paidGrowth, refresh: refreshPaidGrowth };
}

export function useTrends() {
  const { trends, refreshTrends } = useStore();
  return { overview: trends, refresh: refreshTrends };
}

export function useConnectionStatus() {
  return useStore().connectionStatus;
}

export function useConversations() {
  const { conversations, refreshConversations } = useStore();
  return { conversations, refresh: refreshConversations };
}

export function useAgents() {
  const { agents, refreshAgents, activeAgent, selectAgent } = useStore();
  return { agents, refresh: refreshAgents, activeAgent, selectAgent };
}

export function useMemories() {
  const { memories, memoryReflections, refreshMemories } = useStore();
  return { memories, reflections: memoryReflections, refresh: refreshMemories };
}

/** Subscription headroom for the Claude account behind every agent. */
export function useClaudeUsage() {
  const { claudeUsage } = useStore();
  return claudeUsage;
}
