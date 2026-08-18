"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, Check } from "lucide-react";
import type { StorageStats } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useSettings } from "@/lib/hooks";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StoragePanel() {
  const { settings, saveSettings } = useSettings();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getStorage().then(setStats).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  async function compact() {
    setBusy(true);
    setNotice(null);
    try {
      const { result, stats: next } = await api.compactStorage();
      setStats(next);
      setNotice(
        result.compacted || result.pruned
          ? `Removed ${result.compacted + result.pruned} events, reclaimed ${formatBytes(result.reclaimedBytes)}.`
          : "Nothing to compact — everything is already tidy."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Storage"
        description="Session transcripts accumulate as automations run"
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-white/[0.02] p-3 text-body">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted" strokeWidth={1.75} />
            <span className="text-foreground">{stats ? formatBytes(stats.dbBytes) : "…"}</span>
          </div>
          <div className="text-label text-muted">
            {stats ? `${stats.totalEvents.toLocaleString()} events` : ""}
            {stats ? ` · ${stats.sessions} sessions` : ""}
          </div>
          {stats && stats.compactableEvents > 0 && (
            <div className="text-label text-warning">
              {stats.compactableEvents.toLocaleString()} compactable
            </div>
          )}
        </div>

        <p className="text-label leading-relaxed text-muted">
          Streaming events are what a turn looks like as it types. Once it finishes, the
          full text is already stored in the completed message, so those deltas are
          redundant — they&apos;re just the bulk of the log. Jarvis compacts them
          automatically every hour; the transcript you can read is untouched.
        </p>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            <div className="text-body text-foreground">Keep transcripts for</div>
            <div className="text-label text-muted">
              Older sessions keep their summary and status; only the detailed transcript
              is dropped.
            </div>
          </div>
          <Select
            className="h-8 w-auto shrink-0 text-label"
            value={String(settings?.eventRetentionDays ?? 30)}
            onChange={(e) => saveSettings({ eventRetentionDays: Number(e.target.value) })}
          >
            {[
              [7, "7 days"],
              [30, "30 days"],
              [90, "90 days"],
              [365, "1 year"],
              [0, "Forever"],
            ].map(([value, label]) => (
              <option key={value} value={value} className="bg-surface">
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" variant="secondary" onClick={compact} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Compact now
          </Button>
          {notice && (
            <span className="flex items-center gap-1.5 text-label text-success">
              <Check className="h-3.5 w-3.5" />
              {notice}
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
