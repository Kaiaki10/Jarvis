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

  // A turn streams back one delta per token — far too often to run through
  // React state (DESIGN_SYSTEM.md: "never put one React state update per
  // token on the render path"). liveTextRef is the source of truth for the
  // in-progress text; subscribeStreamDelta lets a consumer write it straight
  // into a DOM node on every token. streaming is real state, but only ever
  // flips on the rare start/end of a turn, not per token — consumers use it
  // to decide whether the live line exists at all.
  const liveTextRef = useRef("");
  const streamingRef = useRef(false);
  const [streaming, setStreaming] = useState(false);
  const streamListeners = useRef(new Set<() => void>());

  const subscribeStreamDelta = useCallback((listener: () => void) => {
    streamListeners.current.add(listener);
    return () => {
      streamListeners.current.delete(listener);
    };
  }, []);

  // Stable identity (reads everything through refs) so the long-lived
  // EventSource closure below never holds a stale copy of it.
  const absorbEvent = useCallback((event: SessionEventRecord) => {
    if (event.type === "assistant" || event.type === "result") {
      if (streamingRef.current) {
        streamingRef.current = false;
        liveTextRef.current = "";
        setStreaming(false);
      }
      return;
    }
    if (event.type !== "stream_event") return;
    const payload = event.payload as {
      event?: { type?: string; delta?: { type?: string; text?: string } };
    };
    const delta = payload.event?.delta;
    if (payload.event?.type !== "content_block_delta" || delta?.type !== "text_delta" || !delta.text) {
      return;
    }
    liveTextRef.current += delta.text;
    if (!streamingRef.current) {
      streamingRef.current = true;
      setStreaming(true);
    }
    for (const listener of streamListeners.current) listener();
  }, []);

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
        // Replays the batch through the same reducer the live SSE path uses,
        // so a reconnect that lands mid-turn reconstructs the in-progress
        // text instead of losing it.
        absorbEvent(event);
      }
      const nonStream = incoming.filter((event) => event.type !== "stream_event");
      if (nonStream.length) {
        setEventState((prev) => {
          const current = prev.sessionId === sessionId ? prev.events : [];
          const bySeq = new Map([...current, ...nonStream].map((event) => [event.seq, event]));
          const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
          return { sessionId, events: merged };
        });
      }
      lastSeq.current = { sessionId, seq: incoming.at(-1)?.seq ?? since };
      refreshSession();
      return incoming;
    } catch {
      return [];
    }
  }, [absorbEvent, refreshSession, sessionId]);

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

    async function connect() {
      if (cancelled) return;
      const since = lastSeq.current.sessionId === sessionId ? lastSeq.current.seq : 0;
      const url = await sessionStreamUrl(sessionId, since);
      // The effect may have been torn down while the token was in flight.
      if (cancelled) return;
      const source = new EventSource(url);
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

        absorbEvent(event);
        // Every token has its own seq and reaches here, but only writes to
        // liveTextRef/DOM above -- it never becomes a state update.
        if (event.type === "stream_event") return;

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
          void connect();
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
        // Opening a session mid-turn (a running automation, a page refresh
        // during a reply) should show whatever has already streamed rather
        // than waiting for the next token.
        liveTextRef.current = "";
        streamingRef.current = false;
        for (const event of initial) absorbEvent(event);
        setEventState({ sessionId, events: initial.filter((event) => event.type !== "stream_event") });
        refreshSession();
        void connect();
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
  }, [absorbEvent, catchUpEvents, refreshSession, sessionId]);

  return { session, events, refreshSession, liveTextRef, subscribeStreamDelta, streaming };
}
