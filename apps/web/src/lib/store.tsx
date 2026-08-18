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
  ConnectionRecord,
  NotificationRecord,
  PlatformDefinition,
  ScheduledTaskRecord,
  SessionRecord,
  SettingsRecord,
  TaskRecord,
  UpdateSettingsRequest,
} from "@jarvis/shared";
import { api, globalEventsUrl } from "./api";

export interface ActivityLogEntry {
  id: string;
  time: string;
  text: string;
}

interface StoreValue {
  sessions: SessionRecord[];
  sessionsLoading: boolean;
  sessionById: Map<string, SessionRecord>;
  activity: ActivityLogEntry[];
  tasks: TaskRecord[];
  refreshTasks: () => Promise<void>;
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
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskRecord[]>([]);
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [platforms, setPlatforms] = useState<PlatformDefinition[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const refreshTasks = useCallback(async () => {
    setTasks(await api.listTasks());
  }, []);

  const refreshScheduledTasks = useCallback(async () => {
    setScheduledTasks(await api.listScheduledTasks());
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

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
    api.listPlatforms().then(setPlatforms).catch(() => {});
    refreshConnections().catch(() => {});
    refreshNotifications().catch(() => {});
  }, [refreshConnections, refreshNotifications]);

  useEffect(() => {
    let cancelled = false;

    api.listSessions().then((initial) => {
      if (cancelled) return;
      setSessions(initial);
      setSessionsLoading(false);
      // Backfill the feed so a fresh page load isn't blank — live events append on top.
      setActivity((prev) => {
        const seeded = initial.slice(0, ACTIVITY_LIMIT).map(toActivityEntry);
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...seeded.filter((e) => !seen.has(e.id))].slice(0, ACTIVITY_LIMIT);
      });
    });

    const source = new EventSource(globalEventsUrl());
    source.addEventListener("session-updated", (evt) => {
      const updated = JSON.parse((evt as MessageEvent).data) as SessionRecord;

      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === updated.id);
        const next = idx === -1 ? [updated, ...prev] : [...prev];
        if (idx !== -1) next[idx] = updated;
        return next.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
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

    return () => {
      cancelled = true;
      source.close();
    };
  }, [refreshNotifications]);

  useEffect(() => {
    refreshTasks();
    const id = setInterval(refreshTasks, 10_000);
    return () => clearInterval(id);
  }, [refreshTasks]);

  useEffect(() => {
    refreshScheduledTasks();
    const id = setInterval(refreshScheduledTasks, 15_000);
    return () => clearInterval(id);
  }, [refreshScheduledTasks]);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions]
  );

  const value = useMemo<StoreValue>(
    () => ({
      sessions,
      sessionsLoading,
      sessionById,
      activity,
      tasks,
      refreshTasks,
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
    }),
    [
      sessions,
      sessionsLoading,
      sessionById,
      activity,
      tasks,
      refreshTasks,
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
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function useSessionsList() {
  const { sessions, sessionsLoading, sessionById } = useStore();
  return { sessions, loading: sessionsLoading, sessionById };
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
