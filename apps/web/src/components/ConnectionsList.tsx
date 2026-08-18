"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, AlertTriangle, Plug } from "lucide-react";
import type { ConnectionRecord, PlatformDefinition } from "@jarvis/shared";
import { useConnections } from "@/lib/hooks";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const CATEGORY_LABEL: Record<PlatformDefinition["category"], string> = {
  social: "Social",
  messaging: "Messaging",
  email: "Email",
};

function StatusBadge({ connection }: { connection?: ConnectionRecord }) {
  if (!connection || connection.status === "not_connected") {
    return <Badge tone="neutral">Not connected</Badge>;
  }
  if (connection.status === "connected") {
    return (
      <Badge tone="success" dot>
        Connected
      </Badge>
    );
  }
  return (
    <Badge tone="danger" dot>
      Needs attention
    </Badge>
  );
}

export function ConnectionsList() {
  const { platforms, connections } = useConnections();
  const byId = new Map(connections.map((c) => [c.platformId, c]));

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {platforms.map((platform) => {
        const connection = byId.get(platform.id);
        const connected = connection?.status === "connected";
        const errored = connection?.status === "error";
        return (
          <Link key={platform.id} href={`/connections/${platform.id}`}>
            <Card className="group h-full p-5 transition-colors hover:border-border-strong">
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
                    <div className="text-sm font-medium text-foreground">{platform.name}</div>
                    <div className="text-[11px] text-muted">
                      {CATEGORY_LABEL[platform.category]}
                    </div>
                  </div>
                </div>
                <StatusBadge connection={connection} />
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted">{platform.tagline}</p>

              {connection?.detail && connected && (
                <p className="mt-2 text-xs text-success">{connection.detail}</p>
              )}
              {connection?.errorMessage && errored && (
                <p className="mt-2 text-xs text-danger">{connection.errorMessage}</p>
              )}

              <div className="mt-4 flex items-center gap-1 text-xs font-medium text-muted group-hover:text-foreground">
                {connected || errored ? "Manage" : "Set up"}
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
