"use client";

import { Radio } from "lucide-react";
import { useActivityLog } from "@/lib/hooks";
import { Card, CardHeader } from "@/components/ui/Card";

export function ActivityFeed() {
  const entries = useActivityLog();

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Activity"
        description="Live session updates"
        icon={<Radio className="h-3.5 w-3.5" strokeWidth={1.75} />}
      />
      {/* flex-1 so the column fills its grid row instead of leaving a void
          beside a taller neighbour. */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {entries.length === 0 ? (
          <div className="flex h-full min-h-24 items-center justify-center px-3 py-6 text-label text-muted">
            Nothing yet.
          </div>
        ) : (
          <ol className="relative flex flex-col">
            {/* Hairline rail ties the timestamps together into a timeline. */}
            <span
              aria-hidden
              className="absolute top-2 bottom-2 left-[4.25rem] w-px bg-border"
            />
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="relative flex items-baseline gap-2.5 rounded-lg px-3 py-1.5 text-label transition-colors hover:bg-white/[0.03]"
              >
                <span className="w-12 shrink-0 font-mono tabular-nums text-muted">
                  {entry.time}
                </span>
                <span
                  aria-hidden
                  className="absolute left-[4rem] h-1.5 w-1.5 translate-y-1 rounded-full bg-border-strong"
                />
                <span className="pl-3 text-foreground-secondary">{entry.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
