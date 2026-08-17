"use client";

import Link from "next/link";
import { useSessionsList } from "@/lib/hooks";
import type { SessionStatus } from "@jarvis/shared";

const STATUS_COLOR: Record<SessionStatus, string> = {
  starting: "bg-yellow-500",
  running: "bg-blue-500",
  waiting_permission: "bg-orange-500",
  idle: "bg-green-500",
  completed: "bg-black/40 dark:bg-white/40",
  error: "bg-red-600",
  stopped: "bg-black/30 dark:bg-white/30",
  interrupted: "bg-red-400",
};

export function SessionList() {
  const { sessions, loading } = useSessionsList();

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15 p-4">
      <h2 className="font-semibold mb-3">Sessions</h2>
      {loading && <div className="text-sm text-black/50 dark:text-white/50">Loading…</div>}
      {!loading && sessions.length === 0 && (
        <div className="text-sm text-black/50 dark:text-white/50">
          No sessions yet — launch one above.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <Link
            key={session.id}
            href={`/sessions/${session.id}`}
            className="flex items-center gap-3 rounded border border-black/10 dark:border-white/15 p-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${STATUS_COLOR[session.status]}`}
              title={session.status}
            />
            <span className="flex-1 truncate">{session.title}</span>
            <span className="text-xs text-black/50 dark:text-white/50 shrink-0">
              {session.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
