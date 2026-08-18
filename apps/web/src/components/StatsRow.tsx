"use client";

import { Activity, CalendarClock, CheckCircle2, Circle } from "lucide-react";
import { useScheduledTasksList, useSessionsList, useTasksList } from "@/lib/hooks";
import { isToday } from "@/lib/runStatus";
import { Card } from "@/components/ui/Card";

type Tone = "accent" | "success" | "muted";

const TONE_CLASSES: Record<Tone, { chip: string; glow: string }> = {
  accent: { chip: "bg-accent/15 text-accent-bright", glow: "from-accent/12" },
  success: { chip: "bg-success/12 text-success", glow: "from-success/10" },
  muted: { chip: "bg-white/[0.06] text-muted", glow: "from-white/[0.04]" },
};

function Stat({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  /** Live or complete states get colour; a zero is just a number. */
  tone?: Tone;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <Card className="relative overflow-hidden px-4 py-4">
      {/* Corner wash tints the whole tile when the number actually matters. */}
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.glow} to-transparent`}
      />
      <div className="relative flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.6rem] ${t.chip}`}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-micro tracking-wide text-muted uppercase">
            {label}
          </div>
          <div className="mt-0.5 text-title text-2xl leading-tight tabular-nums text-foreground">
            {value}
          </div>
        </div>
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
      <Stat
        icon={Activity}
        label="Running now"
        value={String(activeSessions)}
        tone={activeSessions > 0 ? "accent" : "muted"}
      />
      <Stat icon={Circle} label="Runs today" value={String(sessionsToday)} />
      <Stat
        icon={CalendarClock}
        label="Automations"
        value={String(activeAutomations)}
        tone={activeAutomations > 0 ? "accent" : "muted"}
      />
      <Stat
        icon={CheckCircle2}
        label="Tasks done"
        value={`${doneTasks}/${tasks.length}`}
        tone={tasks.length > 0 && doneTasks === tasks.length ? "success" : "muted"}
      />
    </div>
  );
}
