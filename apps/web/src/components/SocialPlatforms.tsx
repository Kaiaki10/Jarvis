"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Plug } from "lucide-react";
import type { PlatformDefinition } from "@jarvis/shared";
import { useConnections } from "@/lib/hooks";
import { useWorkflows } from "@/lib/store";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

/**
 * The publishing side of Connections, narrowed to platforms Jarvis can post to.
 * Rendered from the same platform registry rather than a second hand-kept list,
 * so a new social integration appears here the moment it is defined.
 */
const PUBLISHING_CATEGORIES: Array<PlatformDefinition["category"]> = ["social", "messaging"];

export function SocialPlatforms() {
  const { platforms, connections } = useConnections();
  const { overview } = useWorkflows();

  const byId = new Map(connections.map((c) => [c.platformId, c]));

  // How many items actually went out on each platform, from the publication
  // ledger — the one place that records where something really landed.
  const publishedCount = new Map<string, number>();
  for (const run of overview?.publicationRuns ?? []) {
    if (run.status !== "published") continue;
    publishedCount.set(run.platformId, (publishedCount.get(run.platformId) ?? 0) + 1);
  }

  const publishing = platforms.filter((p) => PUBLISHING_CATEGORIES.includes(p.category));

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {publishing.map((platform) => {
        const connection = byId.get(platform.id);
        const connected = connection?.status === "connected";
        const errored = connection?.status === "error";
        const count = publishedCount.get(platform.id) ?? 0;

        return (
          <Card key={platform.id} elevation={0} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04]">
                  {connected ? (
                    <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.75} />
                  ) : errored ? (
                    <AlertTriangle className="h-4 w-4 text-danger" strokeWidth={1.75} />
                  ) : (
                    <Plug className="h-4 w-4 text-muted" strokeWidth={1.75} />
                  )}
                </div>
                <div>
                  <div className="text-body font-medium text-foreground">{platform.name}</div>
                  <div className="text-micro text-muted">
                    {count === 0 ? "Nothing published yet" : `${count} published`}
                  </div>
                </div>
              </div>
              {connected ? (
                <Badge tone="success" dot>
                  Connected
                </Badge>
              ) : errored ? (
                <Badge tone="danger" dot>
                  Needs attention
                </Badge>
              ) : (
                <Badge tone="neutral">Not connected</Badge>
              )}
            </div>

            <p className="mt-3 text-label leading-relaxed text-muted">{platform.tagline}</p>

            <Link
              href={`/under-the-hood/connections/${platform.id}`}
              className="mt-4 inline-block text-label font-medium text-muted hover:text-foreground"
            >
              {connected || errored ? "Manage" : "Set up"}
            </Link>
          </Card>
        );
      })}
    </div>
  );
}
