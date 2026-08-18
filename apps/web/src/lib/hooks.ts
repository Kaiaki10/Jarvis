"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionEventRecord, SessionRecord } from "@jarvis/shared";
import { api, sessionStreamUrl } from "./api";
import { useSessionsList } from "./store";

export {
  useSessionsList,
  useActivityLog,
  useTasksList,
  useMissionsList,
  useEvolution,
  useScheduledTasksList,
  useSettings,
  useConnections,
  useNotifications,
  useMemories,
  usePaidGrowth,
} from "./store";
export type { ActivityLogEntry } from "./store";

/**
 * Per-session live transcript. Unlike the app-wide store this opens its own
 * EventSource, which is fine because only one session detail view is mounted
 * at a time.
 */
export function useSessionStream(sessionId: string, activityKey = 0) {
  const { sessionById } = useSessionsList();
  const liveSession = sessionById.get(sessionId);
  const [eventState, setEventState] = useState<{
    sessionId: string;
    events: SessionEventRecord[];
  }>({ sessionId, events: [] });
  const [sessionState, setSessionState] = useState<{
    sessionId: string;
    session: SessionRecord | null;
  }>({ sessionId, session: null });
  const lastSeq = useRef({ sessionId, seq: 0 });
  const lastStreamSignalAt = useRef(0);
  const latestResultSeq = useRef(0);

  const events = eventState.sessionId === sessionId ? eventState.events : [];
  const storedSession = sessionState.sessionId === sessionId ? sessionState.session : null;
  const session = !liveSession
    ? storedSession
    : !storedSession
      ? liveSession
      : liveSession.updatedAt >= storedSession.updatedAt
        ? liveSession
        : storedSession;

  const refreshSession = useCallback(() => {
    api
      .getSession(sessionId)
      .then((next) => setSessionState({ sessionId, session: next }))
      .catch(() => {});
  }, [sessionId, setSessionState]);

  const catchUpEvents = useCallback(async (): Promise<SessionEventRecord[]> => {
    const since = lastSeq.current.sessionId === sessionId ? lastSeq.current.seq : 0;
    try {
      const incoming = await api.getSessionEvents(sessionId, since);
      if (!incoming.length || lastSeq.current.sessionId !== sessionId) return [];
      for (const event of incoming) {
        if (event.type === "result") latestResultSeq.current = Math.max(latestResultSeq.current, event.seq);
      }
      setEventState((prev) => {
        const current = prev.sessionId === sessionId ? prev.events : [];
        const bySeq = new Map([...current, ...incoming].map((event) => [event.seq, event]));
        const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
        lastSeq.current = { sessionId, seq: merged.at(-1)?.seq ?? since };
        return { sessionId, events: merged };
      });
      refreshSession();
      return incoming;
    } catch {
      return [];
    }
  }, [refreshSession, sessionId, setEventState]);

  // Sending a message opens a short recovery window. It costs nothing while
  // the conversation is idle, stops as soon as the new result arrives, and
  // guarantees a reply cannot be stranded during a backend restart.
  useEffect(() => {
    if (!activityKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const priorResultSeq = latestResultSeq.current;
    const deadline = Date.now() + 30_000;
    const tick = async () => {
      await catchUpEvents();
      if (cancelled || latestResultSeq.current > priorResultSeq || Date.now() >= deadline) return;
      timer = setTimeout(tick, 750);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activityKey, catchUpEvents]);

  // SSE carries the live path. This watchdog only reads the durable log if the
  // named heartbeat disappears, avoiding the old one-request-per-second idle
  // poll while preserving restart recovery.
  useEffect(() => {
    const check = () => {
      if (Date.now() - lastStreamSignalAt.current > 5_000) void catchUpEvents();
    };
    const timer = setInterval(check, 2_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [catchUpEvents]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 500;
    let currentSource: EventSource | null = null;
    lastSeq.current = { sessionId, seq: 0 };
    lastStreamSignalAt.current = Date.now();

    function connect() {
      if (cancelled) return;
      const since = lastSeq.current.sessionId === sessionId ? lastSeq.current.seq : 0;
      const source = new EventSource(sessionStreamUrl(sessionId, since));
      currentSource = source;
      source.onopen = () => {
        reconnectDelay = 500;
        lastStreamSignalAt.current = Date.now();
      };
      source.addEventListener("session-heartbeat", () => {
        lastStreamSignalAt.current = Date.now();
      });
      source.addEventListener("session-event", (evt) => {
        lastStreamSignalAt.current = Date.now();
        const event = JSON.parse((evt as MessageEvent).data) as SessionEventRecord;
        if (lastSeq.current.sessionId !== sessionId) return;
        if (event.seq <= lastSeq.current.seq) return;
        lastSeq.current.seq = event.seq;
        if (event.type === "result") latestResultSeq.current = event.seq;
        setEventState((prev) => ({
          sessionId,
          events: [...(prev.sessionId === sessionId ? prev.events : []), event],
        }));
        if (
          event.type === "result" ||
          event.type === "permission_request" ||
          event.type === "assistant" ||
          event.type === "tool_progress"
        ) {
          refreshSession();
        }
      });
      source.onerror = () => {
        source.close();
        if (cancelled) return;
        lastStreamSignalAt.current = 0;
        void catchUpEvents();
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
          connect();
        }, reconnectDelay);
      };
    }

    // Hydrate first, then tail from the exact cursor. Opening the stream at
    // zero in parallel used to replay the entire transcript a second time and
    // trigger a session refresh for every historical result message.
    api
      .getSessionEvents(sessionId, 0)
      .then((initial) => {
        if (cancelled) return;
        lastSeq.current = { sessionId, seq: initial.at(-1)?.seq ?? 0 };
        latestResultSeq.current = initial.reduce(
          (latest, event) => event.type === "result" ? Math.max(latest, event.seq) : latest,
          0
        );
        setEventState({ sessionId, events: initial });
        refreshSession();
        connect();
      })
      .catch(() => {
        if (cancelled) return;
        refreshSession();
        connect();
      });

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      currentSource?.close();
    };
  }, [catchUpEvents, refreshSession, sessionId]);

  return { session, events, refreshSession };
}
