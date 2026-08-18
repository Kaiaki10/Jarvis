"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { useScheduledTasksList, useSessionsList } from "@/lib/hooks";
import { daysLabel, lastRunOutcome } from "@/lib/runStatus";
import { automationKind } from "@/lib/automationKind";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

function relativeDay(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function AutomationHealth() {
  const { tasks } = useScheduledTasksList();
  const { sessionById } = useSessionsList();

  return (
    <Card>
      <CardHeader
        title="Automation health"
        description="How each automation's last run went"
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
        {tasks.length === 0 && (
          <div className="flex items-center gap-2.5 px-3 py-3 text-body text-muted">
            <CalendarClock className="h-4 w-4" strokeWidth={1.75} />
            No automations yet.
            <Link href="/automations" className="text-foreground hover:underline">
              Create one
            </Link>
          </div>
        )}
        {tasks.map((task) => {
          const outcome = lastRunOutcome(task, sessionById);
          // Every automation shares the same preamble, so the raw prompt makes
          // them all look identical — the derived kind is what distinguishes them.
          const kind = automationKind(task.prompt);
          const Icon = kind.icon;
          const lastRun = task.lastSessionId
            ? sessionById.get(task.lastSessionId)
            : undefined;

          const body = (
            <>
              <Icon className={`h-4 w-4 shrink-0 ${kind.color}`} strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground">{kind.label}</div>
                <div className="mt-0.5 truncate text-micro text-muted">
                  {/* What it actually did reads better here than when it is due —
                      the schedule is on the Automations page either way. */}
                  {lastRun?.summary ??
                    `${task.timeOfDay} · ${daysLabel(task.daysOfWeek)}${
                      task.lastRunAt ? ` · last run ${relativeDay(task.lastRunAt)}` : ""
                    }`}
                </div>
              </div>
              {!task.enabled ? (
                <Badge tone="neutral">Paused</Badge>
              ) : outcome ? (
                <Badge tone={outcome.tone} dot>
                  {outcome.label}
                </Badge>
              ) : (
                <Badge tone="neutral">Not run yet</Badge>
              )}
            </>
          );

          const rowClass = `flex items-center gap-3 rounded-lg px-3 py-2.5 text-body ${
            task.enabled ? "" : "opacity-50"
          }`;

          // Only a run that is still stored is worth linking to.
          return lastRun ? (
            <Link
              key={task.id}
              href={`/sessions/${lastRun.id}`}
              className={`${rowClass} transition-colors hover:bg-white/[0.04]`}
            >
              {body}
            </Link>
          ) : (
            <div key={task.id} className={rowClass}>
              {body}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
