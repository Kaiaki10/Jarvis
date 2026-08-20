"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, History, Trash2 } from "lucide-react";
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

/**
 * Automation run history. The ongoing conversation with Jarvis is deliberately
 * excluded — it lives on the Overview and is not a "run".
 */
export function SessionList({
  limit,
  showViewAll = false,
}: {
  limit?: number;
  showViewAll?: boolean;
}) {
  const { sessions, loading, primarySessionId, removeSession } = useSessionsList();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runs = sessions.filter((s) => s.id !== primarySessionId);
  const visible = limit ? runs.slice(0, limit) : runs;

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    setConfirming(null);
    try {
      await removeSession(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Run history"
        description={loading ? undefined : `${runs.length} total`}
        action={
          showViewAll && runs.length > 0 ? (
            <Link
              href="/sessions"
              className="text-label font-medium text-muted hover:text-foreground"
            >
              View all
            </Link>
          ) : undefined
        }
      />
      {error && <div className="px-5 pb-2 text-label text-danger">{error}</div>}
      <div className="flex flex-col px-2 pb-2">
        {loading && <div className="px-3 py-4 text-body text-muted">Loading…</div>}
        {!loading && visible.length === 0 && (
          <div className="flex items-center gap-2.5 px-3 py-4 text-body text-muted">
            <History className="h-4 w-4" strokeWidth={1.75} />
            No runs yet — scheduled automations will show up here.
          </div>
        )}
        {visible.map((session) => (
          <div
            key={session.id}
            className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-body hover:bg-white/[0.04]"
          >
            <Link href={`/sessions/${session.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{session.title}</span>
                {session.currentActivity ? (
                  <span className="mt-0.5 flex items-center gap-1.5 text-micro text-accent-foreground">
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse-soft rounded-full bg-accent" />
                    <span className="truncate">{session.currentActivity}</span>
                  </span>
                ) : session.summary ? (
                  <span className="mt-0.5 block truncate text-micro text-muted">
                    {session.summary}
                  </span>
                ) : null}
              </span>
              <Badge tone={STATUS_TONE[session.status]} dot>
                {STATUS_LABEL[session.status]}
              </Badge>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100" />
            </Link>
            {confirming === session.id ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-micro text-muted">Delete?</span>
                <button
                  type="button"
                  disabled={busy === session.id}
                  onClick={() => remove(session.id)}
                  className="rounded-md px-2 py-1 text-micro font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-40"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="rounded-md px-2 py-1 text-micro text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Delete run: ${session.title}`}
                onClick={() => setConfirming(session.id)}
                // Revealing on hover alone hides this from keyboard and touch
                // entirely, so focus reveals it too, and below `sm` (no
                // reliable hover state at all) it just stays visible.
                className="shrink-0 rounded-md p-1.5 text-muted opacity-100 transition hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
