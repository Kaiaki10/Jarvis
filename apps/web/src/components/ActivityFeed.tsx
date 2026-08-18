"use client";

import { useActivityLog } from "@/lib/hooks";
import { Card, CardHeader } from "@/components/ui/Card";

export function ActivityFeed() {
  const entries = useActivityLog();

  return (
    <Card>
      <CardHeader title="Activity" description="Live session updates" />
      <div className="flex flex-col gap-0.5 px-2 pb-3 max-h-80 overflow-y-auto">
        {entries.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted">Nothing yet.</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-baseline gap-2.5 rounded-lg px-3 py-1.5 text-xs"
          >
            <span className="shrink-0 font-mono text-muted">{entry.time}</span>
            <span className="text-foreground/80">{entry.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
