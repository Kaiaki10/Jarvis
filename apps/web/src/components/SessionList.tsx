"use client";

import Link from "next/link";
import { ChevronRight, Play } from "lucide-react";
import { useSessionsList } from "@/lib/hooks";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { SessionStatus } from "@jarvis/shared";

const STATUS_TONE: Record<SessionStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  starting: "warning",
  running: "accent",
  waiting_permission: "warning",
  idle: "success",
  completed: "neutral",
  error: "danger",
  stopped: "neutral",
  interrupted: "danger",
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  starting: "Starting",
  running: "Running",
  waiting_permission: "Needs approval",
  idle: "Idle",
  completed: "Completed",
  error: "Error",
  stopped: "Stopped",
  interrupted: "Interrupted",
};

export function SessionList({
  limit,
  showViewAll = false,
}: {
  limit?: number;
  showViewAll?: boolean;
}) {
  const { sessions, loading } = useSessionsList();
  const visible = limit ? sessions.slice(0, limit) : sessions;

  return (
    <Card>
      <CardHeader
        title="Sessions"
        description={loading ? undefined : `${sessions.length} total`}
        action={
          showViewAll && sessions.length > 0 ? (
            <Link
              href="/sessions"
              className="text-xs font-medium text-muted hover:text-foreground"
            >
              View all
            </Link>
          ) : undefined
        }
      />
      <div className="flex flex-col px-2 pb-2">
        {loading && <div className="px-3 py-4 text-sm text-muted">Loading…</div>}
        {!loading && visible.length === 0 && (
          <div className="flex items-center gap-2.5 px-3 py-4 text-sm text-muted">
            <Play className="h-4 w-4" strokeWidth={1.75} />
            No sessions yet.
            <Link href="/" className="text-foreground hover:underline">
              Launch one
            </Link>
          </div>
        )}
        {visible.map((session) => (
          <Link
            key={session.id}
            href={`/sessions/${session.id}`}
            className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-white/[0.04]"
          >
            <span className="min-w-0 flex-1 truncate text-foreground">{session.title}</span>
            <Badge tone={STATUS_TONE[session.status]} dot>
              {STATUS_LABEL[session.status]}
            </Badge>
            <ChevronRight className="h-4 w-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ))}
      </div>
    </Card>
  );
}
