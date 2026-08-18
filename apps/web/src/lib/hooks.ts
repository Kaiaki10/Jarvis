"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionEventRecord, SessionRecord } from "@jarvis/shared";
import { api, sessionStreamUrl } from "./api";

export {
  useSessionsList,
  useActivityLog,
  useTasksList,
  useScheduledTasksList,
} from "./store";
export type { ActivityLogEntry } from "./store";

/**
 * Per-session live transcript. Unlike the app-wide store this opens its own
 * EventSource, which is fine because only one session detail view is mounted
 * at a time.
 */
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
