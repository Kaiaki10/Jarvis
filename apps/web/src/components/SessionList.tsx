"use client";

import Link from "next/link";
import { useSessionsList } from "@/lib/hooks";
import { Panel } from "@/components/hud/Panel";
import type { SessionStatus } from "@jarvis/shared";

const STATUS_STYLE: Record<SessionStatus, string> = {
  starting: "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.7)]",
  running: "bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)] animate-hud-pulse",
  waiting_permission: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)] animate-hud-pulse",
  idle: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
  completed: "bg-cyan-500/30",
  error: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]",
  stopped: "bg-cyan-500/20",
  interrupted: "bg-red-400/70",
};

export function SessionList() {
  const { sessions, loading } = useSessionsList();

  return (
    <Panel title="SESSION-INDEX" eyebrow={`SYSTEM // ${sessions.length} TOTAL`}>
      {loading && <div className="text-sm text-cyan-500/50">Loading…</div>}
      {!loading && sessions.length === 0 && (
        <div className="text-sm text-cyan-500/50">
          No sessions yet — issue a command above to begin.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <Link
            key={session.id}
            href={`/sessions/${session.id}`}
            className="flex items-center gap-3 rounded-sm border border-cyan-500/15 bg-black/20 p-2.5 text-sm text-cyan-100 hover:border-cyan-400/40 hover:bg-cyan-500/5 transition-colors"
          >
            <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_STYLE[session.status]}`} />
            <span className="flex-1 truncate">{session.title}</span>
            <span className="text-[10px] uppercase tracking-wider text-cyan-500/50 shrink-0">
              {session.status}
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
