"use client";

import { useSessionsList, useTasksList } from "@/lib/hooks";
import { Panel } from "@/components/hud/Panel";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-500/50">{label}</div>
      <div className="text-2xl font-bold text-cyan-200 text-glow tabular-nums">
        {value}
        {sub && <span className="ml-1 text-xs font-mono text-cyan-500/50">{sub}</span>}
      </div>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-cyan-950/60 overflow-hidden">
      <div
        className="h-full rounded-full bg-cyan-400 box-glow transition-all"
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export function StatusPanel() {
  const { sessions } = useSessionsList();
  const { tasks } = useTasksList();

  const activeSessions = sessions.filter((s) =>
    ["starting", "running", "waiting_permission"].includes(s.status)
  ).length;
  const idleSessions = sessions.filter((s) => s.status === "idle").length;
  const totalCost = sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const taskProgress = tasks.length ? (doneTasks / tasks.length) * 100 : 0;

  return (
    <Panel title="VITALS">
      <div className="flex flex-col gap-4">
        <Stat label="Active Sessions" value={String(activeSessions)} />
        <Stat label="Idle Sessions" value={String(idleSessions)} />
        <Stat label="Session Cost" value={`$${totalCost.toFixed(3)}`} />
        <div>
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-cyan-500/50 mb-1">
            <span>Tasks Complete</span>
            <span>
              {doneTasks}/{tasks.length}
            </span>
          </div>
          <Bar pct={taskProgress} />
        </div>
      </div>
    </Panel>
  );
}
