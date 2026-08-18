"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Clock, Calendar } from "lucide-react";
import { useScheduledTasksList, useSessionsList } from "@/lib/hooks";
import { formatTime, isToday, lastRunOutcome } from "@/lib/runStatus";
import { automationKind } from "@/lib/automationKind";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface TimelineEntry {
  key: string;
  time: string;
  label: string;
  ran: boolean;
  sessionId: string | null;
  outcomeLabel: string;
  outcomeTone: "neutral" | "accent" | "success" | "warning" | "danger";
}

export function TodaySchedule() {
  const { tasks } = useScheduledTasksList();
  const { sessionById } = useSessionsList();

  const entries = useMemo<TimelineEntry[]>(() => {
    const rows: TimelineEntry[] = [];

    for (const task of tasks) {
      const label = automationKind(task.prompt).label;

      if (task.lastRunAt && isToday(task.lastRunAt)) {
        const outcome = lastRunOutcome(task, sessionById);
        rows.push({
          key: `${task.id}-ran`,
          time: task.lastRunAt,
          label,
          ran: true,
          sessionId: task.lastSessionId,
          outcomeLabel: outcome?.label ?? "Ran",
          outcomeTone: outcome?.tone ?? "neutral",
        });
      }

      if (task.enabled && task.nextRunAt && isToday(task.nextRunAt)) {
        rows.push({
          key: `${task.id}-next`,
          time: task.nextRunAt,
          label,
          ran: false,
          sessionId: null,
          outcomeLabel: "Scheduled",
          outcomeTone: "neutral",
        });
      }
    }

    return rows.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }, [tasks, sessionById]);

  return (
    <Card>
      <CardHeader
        title="Today"
        description="Automations that have run or are due today"
        action={
          <Link
            href="/automations"
            className="text-label font-medium text-muted hover:text-foreground"
          >
            Manage
          </Link>
        }
      />
      <div className="flex flex-col px-2 pb-3">
        {entries.length === 0 && (
          <div className="flex items-center gap-2.5 px-3 py-3 text-body text-muted">
            <Calendar className="h-4 w-4" strokeWidth={1.75} />
            Nothing scheduled for today.
            <Link href="/automations" className="text-foreground hover:underline">
              Schedule one
            </Link>
          </div>
        )}
        {entries.map((entry) => {
          const row = (
            <div
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-body ${
                entry.sessionId ? "hover:bg-white/[0.04]" : ""
              }`}
            >
              <span className="w-14 shrink-0 font-mono text-label text-muted">
                {formatTime(entry.time)}
              </span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  entry.ran ? "bg-muted" : "bg-accent"
                }`}
              />
              <span
                className={`min-w-0 flex-1 truncate ${
                  entry.ran ? "text-foreground" : "text-muted"
                }`}
              >
                {entry.label}
              </span>
              {entry.ran ? (
                <Badge tone={entry.outcomeTone} dot>
                  {entry.outcomeLabel}
                </Badge>
              ) : (
                <span className="flex items-center gap-1 text-micro text-muted">
                  <Clock className="h-3 w-3" />
                  Upcoming
                </span>
              )}
            </div>
          );

          return entry.sessionId ? (
            <Link key={entry.key} href={`/sessions/${entry.sessionId}`}>
              {row}
            </Link>
          ) : (
            <div key={entry.key}>{row}</div>
          );
        })}
      </div>
    </Card>
  );
}
