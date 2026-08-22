"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Megaphone, ExternalLink } from "lucide-react";
import type {
  ContentItemRecord,
  ContentStatus,
  MarketingChannel,
} from "@jarvis/shared";
import { useWorkflows } from "@/lib/store";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const STATUS_TONE: Record<ContentStatus, "neutral" | "accent" | "success" | "warning"> = {
  idea: "neutral",
  draft: "neutral",
  review: "warning",
  scheduled: "accent",
  published: "success",
  measured: "success",
};

/** Pipeline order, so the filter row reads as the funnel it is. */
const STATUSES: ContentStatus[] = ["idea", "draft", "review", "scheduled", "published", "measured"];

const CHANNEL_LABEL: Record<MarketingChannel, string> = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
  blog: "Blog",
};

function when(item: ContentItemRecord): string | null {
  const stamp = item.publishedAt ?? item.scheduledFor;
  if (!stamp) return null;
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return null;
  const label = item.publishedAt ? "Published" : "Scheduled";
  return `${label} ${date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}

export function SocialPosts() {
  const { overview } = useWorkflows();
  const [channel, setChannel] = useState<MarketingChannel | "all">("all");
  const [status, setStatus] = useState<ContentStatus | "all">("all");

  const campaignName = useMemo(
    () => new Map((overview?.workflows ?? []).map((c) => [c.id, c.name])),
    [overview]
  );

  /** Which platform each item actually went out on, when it was published. */
  const publishedTo = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of overview?.publicationRuns ?? []) {
      if (run.status === "published") map.set(run.contentItemId, run.platformId);
    }
    return map;
  }, [overview]);

  const all = useMemo(() => overview?.content ?? [], [overview]);

  // Channels present in the data, rather than every channel the type allows —
  // a filter for a channel with nothing behind it is a dead end.
  const channels = useMemo(
    () => [...new Set(all.map((item) => item.channel))].sort(),
    [all]
  );

  const posts = useMemo(() => {
    return all
      .filter((item) => channel === "all" || item.channel === channel)
      .filter((item) => status === "all" || item.status === status)
      .sort((a, b) => {
        const aWhen = a.publishedAt ?? a.scheduledFor ?? a.updatedAt;
        const bWhen = b.publishedAt ?? b.scheduledFor ?? b.updatedAt;
        return bWhen.localeCompare(aWhen);
      });
  }, [all, channel, status]);

  if (all.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
          <Megaphone className="h-5 w-5 text-muted" strokeWidth={1.75} />
          <div className="text-body text-muted">Jarvis hasn&apos;t written any content yet.</div>
          <Link href="/workflows" className="text-label font-medium text-foreground hover:underline">
            Start a campaign
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <FilterRow
          label="Channel"
          options={[
            { value: "all", label: `All (${all.length})` },
            ...channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] ?? c })),
          ]}
          value={channel}
          onChange={(v) => setChannel(v as MarketingChannel | "all")}
        />
        <FilterRow
          label="Stage"
          options={[
            { value: "all", label: "All" },
            ...STATUSES.filter((s) => all.some((item) => item.status === s)).map((s) => ({
              value: s,
              label: s[0].toUpperCase() + s.slice(1),
            })),
          ]}
          value={status}
          onChange={(v) => setStatus(v as ContentStatus | "all")}
        />
      </div>

      {posts.length === 0 ? (
        <Card>
          <div className="px-5 py-10 text-center text-body text-muted">
            Nothing matches this filter.
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {posts.map((item) => {
            const timing = when(item);
            const platform = publishedTo.get(item.id);
            return (
              <Card key={item.id} elevation={0} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-body font-medium text-foreground">{item.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted">
                      <span>{CHANNEL_LABEL[item.channel] ?? item.channel}</span>
                      {campaignName.get(item.workflowId) && (
                        <>
                          <span className="h-1 w-1 rounded-full bg-border-strong" />
                          <span className="truncate">{campaignName.get(item.workflowId)}</span>
                        </>
                      )}
                      {timing && (
                        <>
                          <span className="h-1 w-1 rounded-full bg-border-strong" />
                          <span>{timing}</span>
                        </>
                      )}
                      {platform && (
                        <>
                          <span className="h-1 w-1 rounded-full bg-border-strong" />
                          <span>via {platform}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                </div>

                <p className="mt-2.5 line-clamp-3 text-label leading-relaxed whitespace-pre-wrap text-foreground-secondary">
                  {item.body}
                </p>

                {/* The agent's own free-text note. Real engagement metrics do not
                    exist yet — see the Analytics increment in the plan. */}
                {item.performanceSummary && (
                  <p className="mt-2 text-label text-muted">{item.performanceSummary}</p>
                )}

                {item.sessionId && (
                  <Link
                    href={`/under-the-hood/brain/runs/${item.sessionId}`}
                    className="mt-3 inline-flex items-center gap-1 text-label font-medium text-muted hover:text-foreground"
                  >
                    View run
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Link>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-micro font-semibold uppercase tracking-[0.14em] text-muted/70">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={value === option.value ? "secondary" : "ghost"}
            className={`h-7 rounded-lg px-2.5 text-micro ${
              value === option.value ? "text-accent-bright" : "text-muted"
            }`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
