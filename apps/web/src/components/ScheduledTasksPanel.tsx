"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, Pause, Play, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useScheduledTasksList } from "@/lib/hooks";
import { DAY_LABELS, daysLabel } from "@/lib/runStatus";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PERMISSION_MODES = ["default", "acceptEdits", "plan", "dontAsk"];

function formatNextRun(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short" })}, ${time}`;
}

export function ScheduledTasksPanel() {
  const { tasks, refresh } = useScheduledTasksList();
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("08:00");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [permissionMode, setPermissionMode] = useState("default");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  return (
    <Card>
      <CardHeader
        title="Automations"
        description="Recurring tasks Jarvis runs on its own"
      />
      <div className="mx-5 mb-4 flex flex-col gap-2.5 rounded-lg border border-border bg-white/[0.02] p-3">
        <Textarea
          className="border-0 bg-transparent p-0 text-sm focus:bg-transparent"
          placeholder="What should Jarvis do automatically? e.g. Summarize overnight emails and draft replies"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Input
            className="h-8 min-w-[200px] flex-1 font-mono text-xs"
            placeholder="Working directory"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
          />
          <Input
            type="time"
            className="h-8 w-auto text-xs"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
          />
          <Select
            className="h-8 w-auto text-xs"
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
                className={`h-7 w-9 rounded-md border text-[11px] font-medium transition-colors ${
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
        {error && <div className="text-xs text-danger">{error}</div>}
      </div>

      <div className="flex flex-col gap-2 px-5 pb-5">
        {tasks.length === 0 && (
          <div className="text-sm text-muted">No automations scheduled yet.</div>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`rounded-lg border border-border p-3 text-sm ${
              task.enabled ? "bg-white/[0.02]" : "opacity-50"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex-1 text-foreground">{task.prompt}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleEnabled(task.id, task.enabled)}
                  className="rounded p-1 text-muted hover:text-foreground"
                  title={task.enabled ? "Pause" : "Resume"}
                >
                  {task.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => remove(task.id)}
                  className="rounded p-1 text-muted hover:text-danger"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <Badge tone="neutral">{task.timeOfDay}</Badge>
              <Badge tone="neutral">{daysLabel(task.daysOfWeek)}</Badge>
              <span>{task.enabled ? `Next: ${formatNextRun(task.nextRunAt)}` : "Paused"}</span>
              {task.lastSessionId && (
                <Link href={`/sessions/${task.lastSessionId}`} className="hover:text-foreground">
                  Last run →
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
