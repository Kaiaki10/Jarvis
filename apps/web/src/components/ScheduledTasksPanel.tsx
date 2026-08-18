"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useScheduledTasksList } from "@/lib/hooks";
import { Panel } from "@/components/hud/Panel";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PERMISSION_MODES = ["default", "acceptEdits", "plan", "dontAsk"];

function daysLabel(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.length === 7) return "Daily";
  if (sorted.length === 5 && sorted.every((d, i) => d === WEEKDAYS[i])) return "Weekdays";
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return "Weekends";
  return sorted.map((d) => DAY_LABELS[d]).join(" ");
}

function formatNextRun(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
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
    <Panel title="AUTOMATIONS" eyebrow="SYSTEM //">
      <div className="flex flex-col gap-2 mb-4 border-b border-cyan-500/10 pb-4">
        <textarea
          className="rounded-sm border border-cyan-500/25 bg-black/30 px-2 py-1.5 text-sm text-cyan-100 outline-none focus:border-cyan-400/60"
          placeholder="What should Jarvis do automatically? e.g. Summarize overnight emails and draft replies"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <input
            className="flex-1 min-w-[200px] rounded-sm border border-cyan-500/20 bg-black/30 px-2 py-1.5 text-xs font-mono text-cyan-200/80 outline-none focus:border-cyan-400/50"
            placeholder="working directory — e.g. C:\Users\you\projects\thing"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
          />
          <input
            type="time"
            className="rounded-sm border border-cyan-500/20 bg-black/30 px-2 py-1.5 text-xs text-cyan-200/80 outline-none focus:border-cyan-400/50"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
          />
          <select
            className="rounded-sm border border-cyan-500/20 bg-black/30 px-2 py-1.5 text-xs text-cyan-200/80 outline-none focus:border-cyan-400/50"
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode} className="bg-black">
                {mode}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {DAY_LABELS.map((label, day) => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className={`h-7 w-9 rounded-sm border text-[10px] uppercase tracking-wide transition-colors ${
                  days.includes(day)
                    ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200"
                    : "border-cyan-500/15 text-cyan-500/40 hover:border-cyan-500/30"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={create}
            disabled={creating}
            className="ml-auto rounded-sm border border-cyan-400/50 bg-cyan-500/10 px-4 py-1.5 text-xs tracking-[0.2em] uppercase text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {creating ? "…" : "Schedule"}
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      <div className="flex flex-col gap-2">
        {tasks.length === 0 && (
          <div className="text-sm text-cyan-500/50">No automations scheduled yet.</div>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`rounded-sm border p-2.5 text-sm ${
              task.enabled
                ? "border-cyan-500/15 bg-black/20 text-cyan-100"
                : "border-cyan-500/10 bg-black/10 text-cyan-500/40"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex-1">{task.prompt}</span>
              <div className="flex items-center gap-2 shrink-0 text-[10px] uppercase tracking-wider">
                <button onClick={() => toggleEnabled(task.id, task.enabled)} className="hover:text-cyan-300">
                  {task.enabled ? "Pause" : "Resume"}
                </button>
                <button onClick={() => remove(task.id)} className="hover:text-red-400">
                  Delete
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] uppercase tracking-wider text-cyan-500/50">
              <span>{task.timeOfDay}</span>
              <span>{daysLabel(task.daysOfWeek)}</span>
              <span>Next: {task.enabled ? formatNextRun(task.nextRunAt) : "Paused"}</span>
              {task.lastSessionId && (
                <Link href={`/sessions/${task.lastSessionId}`} className="hover:text-cyan-300">
                  Last run →
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
