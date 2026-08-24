"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  CalendarClock,
  ChevronRight,
  ArrowRight,
  Pause,
  Play,
  Trash2,
  FlaskConical,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { AutomationRehearsal, ScheduledTaskRecord, SessionRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useScheduledTasksList, useSettings, useSessionsList } from "@/lib/hooks";
import { DAY_LABELS, daysLabel } from "@/lib/runStatus";
import { automationKind } from "@/lib/automationKind";
import { Card } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PERMISSION_MODES = ["default", "acceptEdits", "plan", "dontAsk"];

function formatNextRun(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short" })}, ${time}`;
}

/**
 * One line describing what an automation does. The full prompt stays one click
 * away rather than being truncated away.
 *
 * Every prompt opens with the same pointer to AUTOMATION_RULES.md, so taking the
 * literal first line labelled all six rows identically. This finds the first
 * line that actually says something specific.
 */
function summarize(prompt: string): string {
  const line =
    prompt
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !/AUTOMATION_RULES\.md/i.test(l)) ?? prompt.trim();

  // "Today's job: grow test coverage…" reads better without the scaffolding.
  const withoutPrefix = line.replace(/^(today's|this run's)\s+job:\s*/i, "");
  const sentenceEnd = withoutPrefix.indexOf(". ");
  const summary =
    sentenceEnd > 20 ? withoutPrefix.slice(0, sentenceEnd) : withoutPrefix;
  return summary.length > 90 ? `${summary.slice(0, 88)}…` : summary;
}

/** Shared chevron that rotates when its <details> parent is open. */
const CHEVRON =
  "h-3.5 w-3.5 shrink-0 text-muted transition-transform group-open:rotate-90";

/**
 * The "what it just did" line, and the way through to the whole run.
 *
 * Lives inside a <summary>, where any click toggles the row open. The link
 * stops the click there so following it doesn't also expand the thing you're
 * navigating away from.
 *
 * Only ever links to a session that is actually loaded. A run can be deleted
 * from the Runs page, and a dead link to a missing transcript is worse than
 * plainly saying there is nothing to see.
 */
function LastRunLine({
  task,
  lastRun,
  running,
}: {
  task: ScheduledTaskRecord;
  lastRun: SessionRecord | undefined;
  running: boolean;
}) {
  if (!lastRun) {
    return (
      <span className="mt-1 block text-micro text-muted">
        {task.lastRunAt ? "Last run is no longer stored" : "Not run yet"}
      </span>
    );
  }

  const text = running
    ? (lastRun.currentActivity ?? "Working…")
    : (lastRun.summary ?? "View what it did");

  return (
    <Link
      href={`/under-the-hood/brain/runs/${lastRun.id}`}
      onClick={(e) => e.stopPropagation()}
      title={text}
      className={`group/run mt-1 flex w-fit max-w-full items-center gap-1.5 rounded text-micro transition-colors ${
        running
          ? "text-accent-foreground hover:text-white"
          : "text-muted hover:text-foreground"
      }`}
    >
      <span className="truncate underline decoration-transparent underline-offset-2 transition-colors group-hover/run:decoration-current">
        {text}
      </span>
      <ArrowRight
        className="h-3 w-3 shrink-0 -translate-x-1 opacity-0 transition-all group-hover/run:translate-x-0 group-hover/run:opacity-100"
        strokeWidth={2}
      />
    </Link>
  );
}

/**
 * One automation's row, expandable to its full detail.
 *
 * Not a native `<details>`/`<summary>` — the row carries a link (last run) and
 * two buttons (pause, delete) that need their own independent focus stop and
 * accessible name, and a `<summary>` cannot contain other interactive
 * controls without them becoming unreachable or misannounced to a screen
 * reader (axe's `nested-interactive`, confirmed against this exact markup).
 * A plain row with a dedicated toggle `<button aria-expanded>` gets the same
 * "click anywhere on the row" convenience and correct disclosure semantics
 * without that nesting.
 */
function TaskRow({
  task,
  lastRun,
  running,
  rehearsing,
  rehearsal,
  toggleEnabled,
  remove,
  rehearse,
}: {
  task: ScheduledTaskRecord;
  lastRun: SessionRecord | undefined;
  running: boolean;
  rehearsing: boolean;
  rehearsal: AutomationRehearsal | undefined;
  toggleEnabled: (id: string, enabled: boolean) => void;
  remove: (id: string) => void;
  rehearse: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const kind = automationKind(task.prompt);
  const Icon = kind.icon;

  return (
    <div className="surface-raised relative overflow-hidden rounded-xl border border-border transition-colors hover:border-border-strong">
      <span className={`accent-spine ${kind.spine} ${task.enabled ? "" : "opacity-20"}`} />

      {/* Toggles on any click for mouse convenience, same as the old
          <summary>, but carries no interactive role itself — the chevron
          button below is what makes this operable by keyboard and announced
          to a screen reader. */}
      <div
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-3 py-3 pl-4 pr-3"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Collapse details" : "Expand details"}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="shrink-0 rounded p-0.5 text-muted hover:text-foreground"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={2}
          />
        </button>

        <span
          className={`chip-glow flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ${kind.color} ${
            task.enabled ? "" : "opacity-40 grayscale"
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={`text-micro font-semibold uppercase tracking-[0.14em] ${kind.color}`}
            >
              {kind.label}
            </span>
            {running && (
              <span className="relative flex h-1.5 w-1.5 text-accent">
                <span className="ping-ring absolute inset-0 rounded-full" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
            )}
          </span>
          <span
            className={`mt-0.5 block truncate text-body ${
              task.enabled ? "text-foreground" : "text-muted line-through"
            }`}
          >
            {summarize(task.prompt)}
          </span>
          {/* What it is doing now, or what it did last time — and the way
              through to the full run. Linked only when the session is
              actually there; a link to a pruned run is worse than none. */}
          <LastRunLine task={task} lastRun={lastRun} running={running} />
        </span>

        <span className="hidden shrink-0 flex-col items-end gap-0.5 md:flex">
          <span className="font-mono text-label tabular-nums text-foreground/80">
            {task.timeOfDay}
          </span>
          <span className="text-micro uppercase tracking-wider text-muted">
            {daysLabel(task.daysOfWeek)}
          </span>
        </span>

        <span className="hidden w-28 shrink-0 text-right text-micro text-muted lg:block">
          {task.enabled ? formatNextRun(task.nextRunAt) : "Paused"}
        </span>

        <span className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleEnabled(task.id, task.enabled);
            }}
            className="rounded p-1 text-muted hover:text-foreground"
            title={task.enabled ? "Pause" : "Resume"}
            aria-label={task.enabled ? "Pause" : "Resume"}
          >
            {task.enabled ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              remove(task.id);
            }}
            className="rounded p-1 text-muted hover:text-danger"
            title="Delete"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      <div id={panelId} hidden={!open} className="border-t border-border px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-muted">
          <span>
            Runs {task.timeOfDay} · {daysLabel(task.daysOfWeek)}
          </span>
          <span>Next: {task.enabled ? formatNextRun(task.nextRunAt) : "Paused"}</span>
          <span className="font-mono">{task.permissionMode}</span>
          {task.lastSessionId && (
            <Link
              href={`/under-the-hood/brain/runs/${task.lastSessionId}`}
              className="hover:text-foreground"
            >
              Last run →
            </Link>
          )}
        </div>
        {lastRun?.summary && (
          <div className="mb-2 rounded-md border border-border bg-black/20 p-2.5 text-label text-foreground">
            <div className="mb-1 text-micro uppercase tracking-wide text-muted">
              Last run
            </div>
            {lastRun.summary}
          </div>
        )}
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-black/15 px-3 py-2.5">
          <div>
            <div className="flex items-center gap-1.5 text-label font-medium text-foreground">
              <FlaskConical className="h-3.5 w-3.5 text-accent-bright" strokeWidth={1.75} />
              Rehearsal
            </div>
            <p className="mt-0.5 text-micro text-muted">Check timing, prerequisites, and approval behavior without running it.</p>
          </div>
          <Button size="sm" variant="secondary" disabled={rehearsing} onClick={() => rehearse(task.id)}>
            {rehearsing ? "Checking…" : "Simulate"}
          </Button>
        </div>
        {rehearsal && (
          <div className="mb-2 grid gap-2 rounded-lg border border-accent/20 bg-accent/5 p-3 sm:grid-cols-2">
            <div>
              <div className="text-micro font-medium uppercase tracking-wide text-muted">Preflight</div>
              <div className="mt-2 flex flex-col gap-1.5">
                {rehearsal.checks.map((check) => (
                  <div key={check.label} className="flex items-start gap-2 text-label">
                    {check.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />}
                    <span><span className="text-foreground">{check.label}:</span> <span className="text-muted">{check.detail}</span></span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-micro font-medium uppercase tracking-wide text-muted">Next three runs</div>
              <div className="mt-2 flex flex-col gap-1 text-label text-foreground">
                {rehearsal.nextRuns.map((run) => <span key={run}>{new Date(run).toLocaleString()}</span>)}
              </div>
              <div className="mt-2 text-micro text-muted">
                {rehearsal.approvalRequired ? "External actions will stop for your approval." : "No external-action approval is predicted."}
              </div>
            </div>
          </div>
        )}
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-2.5 font-mono text-micro leading-relaxed text-muted">
          {task.prompt}
        </pre>
      </div>
    </div>
  );
}

export function ScheduledTasksPanel() {
  const { tasks, refresh } = useScheduledTasksList();
  const { settings } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("08:00");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [permissionMode, setPermissionMode] = useState("default");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rehearsals, setRehearsals] = useState<Record<string, AutomationRehearsal>>({});
  const [rehearsing, setRehearsing] = useState<string | null>(null);

  function toggleDay(day: number) {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  async function create() {
    if (!prompt.trim() || !cwd.trim() || !days.length) {
      setError("Prompt, working directory, and at least one day are required.");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      await api.createScheduledTask({ prompt, cwd, timeOfDay, daysOfWeek: days, permissionMode });
      setPrompt("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    await api.updateScheduledTask(id, { enabled: !enabled });
    refresh();
  }

  async function remove(id: string) {
    await api.deleteScheduledTask(id);
    refresh();
  }

  async function rehearse(id: string) {
    setRehearsing(id);
    try {
      const result = await api.rehearseScheduledTask(id);
      setRehearsals((current) => ({ ...current, [id]: result }));
    } finally {
      setRehearsing(null);
    }
  }

  const { sessionById } = useSessionsList();
  const activeCount = tasks.filter((t) => t.enabled).length;
  const runningCount = tasks.filter((t) => {
    const run = t.lastSessionId ? sessionById.get(t.lastSessionId) : undefined;
    return run && ["running", "starting", "waiting_permission"].includes(run.status);
  }).length;

  return (
    <Card className="surface-raised">
      <div className="px-5 pt-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-body font-semibold tracking-tight text-foreground">
            Automation schedule
          </h2>
          <span className="font-mono text-micro tabular-nums text-muted">
            {tasks.length ? (
              <>
                <span className="text-foreground">{activeCount}</span>
                <span className="text-muted"> / {tasks.length} active</span>
                {runningCount > 0 && (
                  <span className="ml-2 text-accent-foreground">
                    {runningCount} running
                  </span>
                )}
              </>
            ) : (
              "none yet"
            )}
          </span>
        </div>
        <p className="mt-0.5 text-label text-muted">
          Recurring work Jarvis runs unattended
        </p>
        <div className="rule-fade mt-3.5" />
      </div>

      {settings && !settings.automationsEnabled && (
        <div className="mx-5 mb-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-label text-warning">
          All automations are paused by the master switch in{" "}
          <Link href="/under-the-hood/settings" className="underline">
            Settings
          </Link>
          .
        </div>
      )}

      <div className="flex flex-col gap-1.5 px-5 pb-5">
        {tasks.map((task) => {
          const lastRun = task.lastSessionId
            ? sessionById.get(task.lastSessionId)
            : undefined;
          const running = !!(
            lastRun && ["running", "starting", "waiting_permission"].includes(lastRun.status)
          );

          return (
            <TaskRow
              key={task.id}
              task={task}
              lastRun={lastRun}
              running={running}
              rehearsing={rehearsing === task.id}
              rehearsal={rehearsals[task.id]}
              toggleEnabled={toggleEnabled}
              remove={remove}
              rehearse={rehearse}
            />
          );
        })}

        {tasks.length === 0 && (
          <div className="flex items-center gap-2.5 py-2 text-body text-muted">
            <CalendarClock className="h-4 w-4" strokeWidth={1.75} />
            No automations yet — add one below.
          </div>
        )}

        <details className="group mt-2 rounded-lg border border-dashed border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-body text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className={CHEVRON} strokeWidth={2} />
            New automation
          </summary>

          <div className="flex flex-col gap-2.5 border-t border-border p-3">
            <Textarea
              className="w-full text-body"
              placeholder="What should Jarvis do automatically?"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Input
                className="h-8 min-w-[200px] flex-1 font-mono text-label"
                placeholder="Working directory"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
              />
              <Input
                type="time"
                className="h-8 w-auto text-label"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
              />
              <Select
                className="h-8 w-auto text-label"
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value)}
              >
                {PERMISSION_MODES.map((mode) => (
                  <option key={mode} value={mode} className="bg-surface">
                    {mode}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {DAY_LABELS.map((label, day) => (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    className={`h-7 w-9 rounded-md border text-micro font-medium transition-colors ${
                      days.includes(day)
                        ? "border-accent/40 bg-accent/15 text-accent-foreground"
                        : "border-border text-muted hover:border-border-strong"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={create} disabled={creating} className="ml-auto">
                <CalendarPlus className="h-3.5 w-3.5" />
                Schedule
              </Button>
            </div>
            {error && <div className="text-label text-danger">{error}</div>}
          </div>
        </details>
      </div>
    </Card>
  );
}
