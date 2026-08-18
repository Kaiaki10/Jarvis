"use client";

import { Activity, CalendarClock, CheckCircle2, Circle } from "lucide-react";
import { useScheduledTasksList, useSessionsList, useTasksList } from "@/lib/hooks";
import { isToday } from "@/lib/runStatus";
import { Card } from "@/components/ui/Card";

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <Card className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent-foreground">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <div>
        <div className="text-[11px] text-muted">{label}</div>
        <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
      </div>
    </Card>
  );
}

export function StatsRow() {
  const { sessions } = useSessionsList();
  const { tasks } = useTasksList();
  const { tasks: scheduled } = useScheduledTasksList();

  const activeSessions = sessions.filter((s) =>
    ["starting", "running", "waiting_permission"].includes(s.status)
  ).length;
  const sessionsToday = sessions.filter((s) => isToday(s.createdAt)).length;
  const activeAutomations = scheduled.filter((t) => t.enabled).length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat icon={Activity} label="Running now" value={String(activeSessions)} />
      <Stat icon={Circle} label="Sessions today" value={String(sessionsToday)} />
      <Stat icon={CalendarClock} label="Active automations" value={String(activeAutomations)} />
      <Stat
        icon={CheckCircle2}
        label="Tasks complete"
        value={`${doneTasks}/${tasks.length}`}
      />
    </div>
  );
}
