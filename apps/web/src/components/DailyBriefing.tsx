"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Flag, ShieldQuestion, Sunrise } from "lucide-react";
import { useMissionsList, useNotifications, useScheduledTasksList, useSessionsList, useTasksList } from "@/lib/hooks";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

const LAST_VISIT_KEY = "jarvis:last-command-center-visit";

function relativeDate(value: string) {
  const delta = new Date(value).getTime() - Date.now();
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(hours, "hour");
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(hours / 24), "day");
}

export function DailyBriefing() {
  const { missions, deliverables, updates } = useMissionsList();
  const { tasks } = useTasksList();
  const { sessions } = useSessionsList();
  const { tasks: automations } = useScheduledTasksList();
  const { unread } = useNotifications();
  const [lastVisit, setLastVisit] = useState<number | null>(null);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(LAST_VISIT_KEY));
    const now = Date.now();
    const timer = window.setTimeout(() => {
      if (Number.isFinite(stored) && stored > 0) setLastVisit(stored);
      window.localStorage.setItem(LAST_VISIT_KEY, String(now));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const briefing = useMemo(() => {
    const active = missions.filter((mission) => mission.status === "active");
    const planned = missions.filter((mission) => mission.status === "planned");
    const blocked = missions.filter((mission) => mission.status === "blocked");
    const approvals = sessions.filter((session) => session.status === "waiting_permission");
    const missionReviews = updates.filter((update) => update.status === "proposed");
    const completedToday = tasks.filter((task) => task.completedAt && new Date(task.completedAt).toDateString() === new Date().toDateString());
    const ready = deliverables.filter((item) => item.status === "ready");
    const nextAutomation = automations
      .filter((item) => item.enabled && item.nextRunAt)
      .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())[0];
    const sinceAway = lastVisit
      ? sessions.filter((session) => new Date(session.updatedAt).getTime() > lastVisit)
      : [];
    const focus = blocked[0]
      ? { label: "Unblock", title: blocked[0].title, href: "/missions" }
      : active.find((mission) => mission.nextAction)
        ? { label: "Next move", title: active.find((mission) => mission.nextAction)!.nextAction!, href: "/missions" }
        : active[0]
          ? { label: "Advance", title: active[0].title, href: "/missions" }
          : planned[0]
            ? { label: "Ready to start", title: planned[0].title, href: "/missions" }
            : { label: "Start here", title: "Define the next outcome worth pursuing", href: "/missions" };
    return { active, planned, blocked, approvals, missionReviews, completedToday, ready, nextAutomation, sinceAway, focus };
  }, [missions, deliverables, updates, sessions, tasks, automations, lastVisit]);

  return (
    <Card elevation={2} className="overflow-hidden">
      <div className="relative p-5">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent" />
        <div className="relative flex flex-wrap items-start gap-5">
          <div className="min-w-[220px] flex-1">
            <div className="flex items-center gap-2 text-micro font-medium tracking-wide text-accent-foreground uppercase">
              <Sunrise className="h-4 w-4 text-accent-bright" strokeWidth={1.75} />
              Daily briefing
            </div>
            <h2 className="mt-2 text-title text-foreground">
              {briefing.blocked.length
                ? `${briefing.blocked.length} mission${briefing.blocked.length === 1 ? " is" : "s are"} blocked`
                : briefing.active.length
                  ? `${briefing.active.length} mission${briefing.active.length === 1 ? " is" : "s are"} moving`
                  : briefing.planned.length
                    ? `${briefing.planned.length} mission${briefing.planned.length === 1 ? " is" : "s are"} ready to start`
                    : "Your command center is clear"}
            </h2>
            <p className="mt-1 text-body text-foreground-secondary">
              {briefing.sinceAway.length > 0
                ? `Since you were away, ${briefing.sinceAway.length} run${briefing.sinceAway.length === 1 ? "" : "s"} changed.`
                : "Here is the shortest path to meaningful progress."}
            </p>
            <Link href={briefing.focus.href} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-body text-accent-foreground hover:bg-accent/15">
              <span className="text-micro font-semibold uppercase text-accent-bright">{briefing.focus.label}</span>
              <span>{briefing.focus.title}</span>
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Link>
          </div>

          <div className="grid min-w-[280px] grid-cols-2 gap-2 lg:min-w-[420px]">
            <BriefStat icon={Flag} value={briefing.active.length} label="Active missions" href="/missions" />
            <BriefStat icon={ShieldQuestion} value={briefing.approvals.length + briefing.missionReviews.length} label="Decisions waiting" tone={briefing.approvals.length + briefing.missionReviews.length ? "warning" : "neutral"} href={briefing.approvals[0] ? `/sessions/${briefing.approvals[0].id}` : briefing.missionReviews.length ? "/missions" : "/sessions"} />
            <BriefStat icon={CheckCircle2} value={briefing.completedToday.length} label="Steps done today" tone={briefing.completedToday.length ? "success" : "neutral"} href="/tasks" />
            <BriefStat icon={CalendarClock} value={briefing.ready.length} label="Ready to review" tone={briefing.ready.length ? "accent" : "neutral"} href="/missions" />
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-micro text-muted">
          {briefing.nextAutomation?.nextRunAt ? (
            <span>Next automation {relativeDate(briefing.nextAutomation.nextRunAt)}</span>
          ) : (
            <span>No automation is queued</span>
          )}
          {unread > 0 && <Badge tone="accent">{unread} unread update{unread === 1 ? "" : "s"}</Badge>}
          {briefing.ready.length > 0 && <Badge tone="success">{briefing.ready.length} deliverable{briefing.ready.length === 1 ? "" : "s"} ready</Badge>}
        </div>
      </div>
    </Card>
  );
}

function BriefStat({ icon: Icon, value, label, href, tone = "neutral" }: {
  icon: typeof Flag;
  value: number;
  label: string;
  href: string;
  tone?: "neutral" | "accent" | "success" | "warning";
}) {
  const colors = {
    neutral: "text-muted",
    accent: "text-accent-bright",
    success: "text-success",
    warning: "text-warning",
  };
  return (
    <Link href={href} className="rounded-lg border border-border bg-black/15 p-3 hover:border-border-strong hover:bg-white/[0.03]">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${colors[tone]}`} strokeWidth={1.75} />
        <span className="text-title text-foreground">{value}</span>
      </div>
      <div className="mt-1 text-micro text-muted">{label}</div>
    </Link>
  );
}
