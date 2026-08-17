"use client";

import { useActivityLog } from "@/lib/hooks";
import { Panel } from "@/components/hud/Panel";

export function ActivityLog() {
  const entries = useActivityLog();

  return (
    <Panel title="RT-LOG">
      <div className="flex flex-col gap-1.5 text-xs font-mono max-h-72 overflow-y-auto">
        {entries.length === 0 && (
          <div className="text-cyan-500/40">Awaiting activity…</div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="text-cyan-200/80">
            <span className="text-cyan-500/40">[{entry.time}]</span> {entry.text}
          </div>
        ))}
      </div>
    </Panel>
  );
}
