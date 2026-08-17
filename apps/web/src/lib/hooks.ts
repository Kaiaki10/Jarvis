"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionEventRecord, SessionRecord } from "@jarvis/shared";
import { api, globalEventsUrl, sessionStreamUrl } from "./api";

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
