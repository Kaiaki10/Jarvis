"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, ShieldQuestion } from "lucide-react";
import { useSessionsList } from "@/lib/hooks";
import { outcomeForStatus } from "@/lib/runStatus";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

/**
 * Failures older than this stop being actionable and would otherwise pile up
 * forever. Blocked sessions are always shown regardless of age — they're stuck
 * until someone answers.
 */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function AttentionQueue() {
  const { sessions, loading, primarySessionId } = useSessionsList();

  const items = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter((session) => {
        const outcome = outcomeForStatus(session.status);
        if (!outcome.needsAttention) return false;
        if (session.status === "waiting_permission") return true;
        // The conversation ends up "interrupted" every time the service
        // restarts. That isn't a failure — the next message resumes it — so
        // only a genuine block is worth surfacing for it.
        if (session.id === primarySessionId) return false;
        return now - new Date(session.updatedAt).getTime() < RECENT_WINDOW_MS;
      })
      .sort((a, b) => {
        const aBlocked = a.status === "waiting_permission" ? 0 : 1;
        const bBlocked = b.status === "waiting_permission" ? 0 : 1;
        if (aBlocked !== bBlocked) return aBlocked - bBlocked;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [sessions, primarySessionId]);

  if (loading) return null;

  if (items.length === 0) {
    return (
      <Card className="flex items-center gap-3 px-5 py-4">
        <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={2} />
        <div>
          <div className="text-sm font-medium text-foreground">All clear</div>
          <div className="text-xs text-muted">
            Nothing is blocked or failing. Jarvis will surface anything that needs you here.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-warning/30">
      <CardHeader
        title="Needs your attention"
        description={`${items.length} item${items.length === 1 ? "" : "s"} waiting on you`}
      />
      <div className="flex flex-col px-2 pb-2">
        {items.map((session) => {
          const outcome = outcomeForStatus(session.status);
          const blocked = session.status === "waiting_permission";
          const Icon = blocked ? ShieldQuestion : AlertTriangle;
          const scheduled = session.title.startsWith("[Scheduled]");
          return (
            <Link
              key={session.id}
              href={`/sessions/${session.id}`}
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-white/[0.04]"
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${blocked ? "text-warning" : "text-danger"}`}
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {session.title.replace("[Scheduled] ", "")}
              </span>
              {scheduled && <Badge tone="neutral">Automation</Badge>}
              <Badge tone={outcome.tone} dot>
                {outcome.label}
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
