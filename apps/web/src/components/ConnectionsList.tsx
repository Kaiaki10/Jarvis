"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, AlertTriangle, Plug, RadioTower, ShieldCheck, Sparkles } from "lucide-react";
import type { ConnectionRecord, PlatformDefinition } from "@jarvis/shared";
import { useConnections } from "@/lib/hooks";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const CATEGORY_LABEL: Record<PlatformDefinition["category"], string> = {
  social: "Social",
  messaging: "Messaging",
  email: "Email",
  advertising: "Advertising",
  notifications: "Notifications",
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

  const advertising = platforms.filter((platform) => platform.category === "advertising");
  const channels = platforms.filter((platform) => platform.category !== "advertising");

  function cards(items: PlatformDefinition[], featured = false) {
    return items.map((platform) => {
        const connection = byId.get(platform.id);
        const connected = connection?.status === "connected";
        const errored = connection?.status === "error";
        return (
          <Link key={platform.id} href={`/connections/${platform.id}`}>
            <Card elevation={featured ? 1 : 0} className={`group relative h-full overflow-hidden p-5 transition-colors hover:border-border-strong ${featured ? "bg-gradient-to-br from-accent/10 via-transparent to-transparent" : ""}`}>
              {featured && <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-accent/10 blur-3xl" />}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04]">
                    {connected ? (
                      <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.75} />
                    ) : errored ? (
                      <AlertTriangle className="h-4 w-4 text-danger" strokeWidth={1.75} />
                    ) : (
                      featured ? <RadioTower className="h-4 w-4 text-accent-bright" strokeWidth={1.75} /> : <Plug className="h-4 w-4 text-muted" strokeWidth={1.75} />
                    )}
                  </div>
                  <div>
                    <div className="text-body font-medium text-foreground">{platform.name}</div>
                    <div className="text-micro text-muted">
                      {CATEGORY_LABEL[platform.category]}
                    </div>
                  </div>
                </div>
                <StatusBadge connection={connection} />
              </div>

              <p className="mt-3 text-label leading-relaxed text-muted">{platform.tagline}</p>

              {platform.capabilities?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {platform.capabilities.map((capability) => <Badge key={capability} tone="neutral">{capability}</Badge>)}
                </div>
              ) : null}

              {connection?.detail && connected && (
                <p className="mt-2 text-label text-success">{connection.detail}</p>
              )}
              {connection?.errorMessage && errored && (
                <p className="mt-2 text-label text-danger">{connection.errorMessage}</p>
              )}

              <div className="mt-4 flex items-center gap-1 text-label font-medium text-muted group-hover:text-foreground">
                {connected || errored ? "Manage" : "Set up"}
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Card>
          </Link>
        );
      });
  }

  return (
    <div className="space-y-7">
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><div className="flex items-center gap-2 text-heading text-foreground"><Sparkles className="h-4 w-4 text-accent-bright" /> Acquisition intelligence</div><p className="mt-1 text-label text-muted">Live evidence for Jarvis&apos;s guarded investment decisions.</p></div>
          <div className="flex items-center gap-2 text-micro text-muted"><ShieldCheck className="h-3.5 w-3.5 text-success" /> Credentials stay encrypted in the orchestrator</div>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">{cards(advertising, true)}</div>
      </section>
      <section>
        <div className="mb-3"><div className="text-heading text-foreground">Channels & delivery</div><p className="mt-1 text-label text-muted">Publishing, conversations, and customer touchpoints.</p></div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{cards(channels)}</div>
      </section>
    </div>
  );
}
