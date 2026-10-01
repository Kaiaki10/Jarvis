"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentRecord,
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
  WorkflowOverview,
  BrandsOverview,
  MemoryRecord,
  MemoryReflectionRecord,
  CustomerOperationsOverview,
  PaidGrowthOverview,
  CampaignExperimentsOverview,
  TrendsOverview,
  ClaudeUsageSnapshot,
} from "@jarvis/shared";
import { api, globalEventsUrl } from "./api";

export interface ActivityLogEntry {
  id: string;
  time: string;
  text: string;
}

interface StoreValue {
  connectionStatus: "connecting" | "connected" | "offline";
  /** Jarvis's own record: persona and brain. Null until the first load lands. */
  jarvis: AgentRecord | null;
  refreshJarvis: () => Promise<void>;
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
  campaigns: WorkflowOverview | null;
  refreshWorkflows: () => Promise<void>;
  brands: BrandsOverview | null;
  refreshBrands: () => Promise<void>;
  customerOperations: CustomerOperationsOverview | null;
  refreshCustomerOperations: () => Promise<void>;
  paidGrowth: PaidGrowthOverview | null;
  refreshPaidGrowth: () => Promise<void>;
  campaignExperiments: CampaignExperimentsOverview | null;
  refreshCampaignExperiments: () => Promise<void>;
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
  notifications: NotificationRecord[];
  unreadNotifications: number;
  refreshNotifications: () => Promise<void>;
  /** Null until the first session of this process reports a rate-limit window. */
  claudeUsage: ClaudeUsageSnapshot | null;
}

const StoreContext = createContext<StoreValue | null>(null);

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
  const [jarvis, setJarvis] = useState<AgentRecord | null>(null);
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
  const [campaigns, setCampaigns] = useState<WorkflowOverview | null>(null);
  const [brands, setBrands] = useState<BrandsOverview | null>(null);
  const [customerOperations, setCustomerOperations] = useState<CustomerOperationsOverview | null>(null);
  const [paidGrowth, setPaidGrowth] = useState<PaidGrowthOverview | null>(null);
  const [campaignExperiments, setCampaignExperiments] = useState<CampaignExperimentsOverview | null>(null);
  const [trends, setTrends] = useState<TrendsOverview | null>(null);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskRecord[]>([]);
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [platforms, setPlatforms] = useState<PlatformDefinition[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [claudeUsage, setClaudeUsage] = useState<ClaudeUsageSnapshot | null>(null);

  const refreshTasks = useCallback(async () => {
    setTasks(await api.listTasks());
  }, []);

  const refreshScheduledTasks = useCallback(async () => {
    setScheduledTasks(await api.listScheduledTasks());
  }, []);

  const refreshJarvis = useCallback(async () => {
    setJarvis(await api.getJarvis());
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

  const refreshWorkflows = useCallback(async () => {
    setCampaigns(await api.getWorkflows());
  }, []);

  const refreshBrands = useCallback(async () => {
    setBrands(await api.getBrands());
  }, []);

  const refreshCustomerOperations = useCallback(async () => {
    setCustomerOperations(await api.getCustomerOperations());
  }, []);

  const refreshPaidGrowth = useCallback(async () => {
    setPaidGrowth(await api.getPaidGrowth());
  }, []);

  const refreshCampaignExperiments = useCallback(async () => {
    setCampaignExperiments(await api.getCampaignExperiments());
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

      source.addEventListener("workflows-changed", () => {
        refreshWorkflows().catch(() => {});
        refreshTrends().catch(() => {});
      });

      source.addEventListener("brands-changed", () => {
        refreshBrands().catch(() => {});
      });

      source.addEventListener("memories-changed", () => {
        refreshMemories().catch(() => {});
      });

      source.addEventListener("agents-changed", () => {
        refreshJarvis().catch(() => {});
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
        refreshCampaignExperiments().catch(() => {});
        refreshTrends().catch(() => {});
      });

      source.addEventListener("open", () => {
        reconnectDelay = 1000;
        setConnectionStatus("connected");
        // SSE has no replay cursor for global events. Reload authoritative state
        // so updates that happened while disconnected cannot leave the UI stale.
        void Promise.allSettled([
          refreshJarvis(),
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
          // Fetched once at mount, then kept current by the stream.
          api.getUsage().then(setClaudeUsage),
          refreshConnections(),
          refreshNotifications(),
          refreshTasks(),
          refreshMissions(),
          refreshScheduledTasks(),
          refreshWorkflows(),
          refreshBrands(),          refreshMemories(),
          refreshPrimaryChat(),
          refreshCustomerOperations(),
          refreshPaidGrowth(),
          refreshCampaignExperiments(),
          refreshTrends(),
        ]);
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
    refreshBrands,
    refreshCustomerOperations,
    refreshPaidGrowth,
    refreshCampaignExperiments,
    refreshTrends,
    refreshConnections,
    refreshJarvis,
    refreshMemories,
    refreshMissions,
    refreshNotifications,
    refreshPrimaryChat,
    refreshScheduledTasks,
    refreshTasks,
  ]);

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
      jarvis,
      refreshJarvis,
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
      campaigns,
      refreshWorkflows,
      brands,
      refreshBrands,
      customerOperations,
      refreshCustomerOperations,
      paidGrowth,
      refreshPaidGrowth,
      campaignExperiments,
      refreshCampaignExperiments,
      trends,
      refreshTrends,
      scheduledTasks,
      refreshScheduledTasks,
      settings,
      saveSettings,
      platforms,
      connections,
      refreshConnections,
      notifications,
      unreadNotifications,
      refreshNotifications,
      claudeUsage,
    }),
    [
      connectionStatus,
      jarvis,
      refreshJarvis,
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
      campaigns,
      refreshWorkflows,
      brands,
      refreshBrands,
      customerOperations,
      refreshCustomerOperations,
      paidGrowth,
      refreshPaidGrowth,
      campaignExperiments,
      refreshCampaignExperiments,
      trends,
      refreshTrends,
      scheduledTasks,
      refreshScheduledTasks,
      settings,
      saveSettings,
      platforms,
      connections,
      refreshConnections,
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

export function useNotifications() {
  const { notifications, unreadNotifications, refreshNotifications } = useStore();
  return { notifications, unread: unreadNotifications, refresh: refreshNotifications };
}

export function useMissionsList() {
  const { missions, deliverables, missionUpdates, refreshMissions } = useStore();
  return { missions, deliverables, updates: missionUpdates, refresh: refreshMissions };
}

export function useWorkflows() {
  const { campaigns, refreshWorkflows } = useStore();
  return { overview: campaigns, refresh: refreshWorkflows };
}

export function useBrands() {
  const { brands, refreshBrands } = useStore();
  return { overview: brands, refresh: refreshBrands };
}

export function useCustomerOperations() {
  const { customerOperations, refreshCustomerOperations } = useStore();
  return { overview: customerOperations, refresh: refreshCustomerOperations };
}

export function usePaidGrowth() {
  const { paidGrowth, refreshPaidGrowth } = useStore();
  return { overview: paidGrowth, refresh: refreshPaidGrowth };
}

export function useCampaignExperiments() {
  const { campaignExperiments, refreshCampaignExperiments } = useStore();
  return { overview: campaignExperiments, refresh: refreshCampaignExperiments };
}

export function useTrends() {
  const { trends, refreshTrends } = useStore();
  return { overview: trends, refresh: refreshTrends };
}

export function useConnectionStatus() {
  return useStore().connectionStatus;
}

/** Jarvis's own record — persona and the brain chat and automations run on. */
export function useJarvis() {
  const { jarvis, refreshJarvis } = useStore();
  return { jarvis, refresh: refreshJarvis };
}

export function useMemories() {
  const { memories, memoryReflections, refreshMemories } = useStore();
  return { memories, reflections: memoryReflections, refresh: refreshMemories };
}

/** Subscription headroom for the Claude account Jarvis runs on. */
export function useClaudeUsage() {
  const { claudeUsage } = useStore();
  return claudeUsage;
}
