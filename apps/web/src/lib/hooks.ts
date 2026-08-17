"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionEventRecord, SessionRecord, TaskRecord } from "@jarvis/shared";
import { api, globalEventsUrl, sessionStreamUrl } from "./api";

export function useTasksList() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    return api.listTasks().then((t) => {
      setTasks(t);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return { tasks, loading, refresh };
}

export function useSessionsList() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.listSessions().then((initial) => {
      if (!cancelled) {
        setSessions(initial);
        setLoading(false);
      }
    });

    const source = new EventSource(globalEventsUrl());
    source.addEventListener("session-updated", (evt) => {
      const updated = JSON.parse((evt as MessageEvent).data) as SessionRecord;
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === updated.id);
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = updated;
        return next.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
    });

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  return { sessions, loading };
}

export interface ActivityLogEntry {
  id: string;
  time: string;
  text: string;
}

export function useActivityLog(limit = 30) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);

  useEffect(() => {
    const source = new EventSource(globalEventsUrl());
    source.addEventListener("session-updated", (evt) => {
      const session = JSON.parse((evt as MessageEvent).data) as SessionRecord;
      const entry: ActivityLogEntry = {
        id: `${session.id}-${session.updatedAt}`,
        time: new Date(session.updatedAt).toLocaleTimeString([], { hour12: false }),
        text: `${session.title.slice(0, 40)} → ${session.status.toUpperCase()}`,
      };
      setEntries((prev) => [entry, ...prev].slice(0, limit));
    });
    return () => source.close();
  }, [limit]);

  return entries;
}

export function useSessionStream(sessionId: string) {
  const [events, setEvents] = useState<SessionEventRecord[]>([]);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const lastSeq = useRef(0);

  const refreshSession = useCallback(() => {
    api.getSession(sessionId).then(setSession).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    lastSeq.current = 0;

    api.getSessionEvents(sessionId, 0).then((initial) => {
      if (cancelled) return;
      setEvents(initial);
      if (initial.length) lastSeq.current = initial[initial.length - 1].seq;
    });
    refreshSession();

    const source = new EventSource(sessionStreamUrl(sessionId, 0));
    source.addEventListener("session-event", (evt) => {
      const event = JSON.parse((evt as MessageEvent).data) as SessionEventRecord;
      if (event.seq <= lastSeq.current) return;
      lastSeq.current = event.seq;
      setEvents((prev) => [...prev, event]);
      if (event.type === "result" || event.type === "permission_request") {
        refreshSession();
      }
    });

    return () => {
      cancelled = true;
      source.close();
    };
  }, [sessionId, refreshSession]);

  return { session, events, refreshSession };
}
