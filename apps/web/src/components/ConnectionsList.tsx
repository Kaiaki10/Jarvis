"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, AlertTriangle, Plug, RadioTower, ShieldCheck, Sparkles } from "lucide-react";
import type { ConnectionRecord, PlatformDefinition } from "@jarvis/shared";
import { useState } from "react";
import { useConnections } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const CATEGORY_LABEL: Record<PlatformDefinition["category"], string> = {
  social: "Social",
  messaging: "Messaging",
  email: "Email",
  advertising: "Advertising",
  notifications: "Notifications",
  finance: "Finance",
};

/**
 * Reading order for the page. Advertising leads because it is the one group
 * that spends money on its own; finance follows because it is what funds it.
 * The `category` field has been on every platform definition since these were
 * written — this is the first surface that actually reads it.
 */
const CATEGORY_ORDER: Array<PlatformDefinition["category"]> = [
  "advertising",
  "finance",
  "social",
  "messaging",
  "email",
  "notifications",
];

/**
 * The page's sections, derived from the reading order above rather than listed
 * again, so a category can never appear in the rail without a section behind it
 * — or the other way round.
 */
export const CONNECTION_SECTIONS = CATEGORY_ORDER.map((category) => ({
  id: `connections-${category}`,
  label: CATEGORY_LABEL[category],
}));

const CATEGORY_BLURB: Record<PlatformDefinition["category"], string> = {
  advertising: "Live evidence for Jarvis's guarded investment decisions.",
  finance: "Cards, wallets, and the rails Jarvis can move value over.",
  social: "Where Jarvis publishes and builds an audience.",
  messaging: "Real-time conversations, inbound and outbound.",
  email: "Sending and receiving mail on your behalf.",
  notifications: "How Jarvis reaches you when something needs a human.",
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

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: platforms.filter((platform) => platform.category === category),
  })).filter((group) => group.items.length > 0);

  function cards(items: PlatformDefinition[], featured = false) {
    return items.map((platform) => {
        const connection = byId.get(platform.id);
        const connected = connection?.status === "connected";
        const errored = connection?.status === "error";
        return (
          <Link key={platform.id} href={`/under-the-hood/connections/${platform.id}`}>
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
                  {/* The section heading already names the category, so the card
                      carries the platform's own detail instead of repeating it. */}
                  <div>
                    <div className="text-body font-medium text-foreground">{platform.name}</div>
                    {platform.dataFreshness && (
                      <div className="text-micro text-muted">{platform.dataFreshness}</div>
                    )}
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

              <CapControl connection={connection} />

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
      {grouped.map(({ category, items }, index) => {
        const featured = category === "advertising";
        return (
          <section key={category} id={`connections-${category}`} className="scroll-mt-24">
            {/* Held in place while you scan the group's cards, so a long grid
                never leaves you looking at platforms with no idea which
                category you are in. */}
            <div className="material-glass sticky top-[3.75rem] z-10 mb-3 flex flex-wrap items-end justify-between gap-3 py-2 lg:top-0">
              <div>
                <div className="flex items-center gap-2 text-heading text-foreground">
                  {featured && <Sparkles className="h-4 w-4 text-accent-bright" />}
                  {CATEGORY_LABEL[category]}
                </div>
                <p className="mt-1 text-label text-muted">{CATEGORY_BLURB[category]}</p>
              </div>
              {/* Said once, at the top, rather than repeated over every group. */}
              {index === 0 && (
                <div className="flex items-center gap-2 text-micro text-muted">
                  <ShieldCheck className="h-3.5 w-3.5 text-success" />
                  Credentials stay encrypted in the orchestrator
                </div>
              )}
            </div>
            <div
              className={`grid grid-cols-1 gap-3 ${featured ? "lg:grid-cols-3" : "md:grid-cols-2"}`}
            >
              {cards(items, featured)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Per-account daily action cap, edited in place.
 *
 * The whole card is a link to the setup page, so every interaction here has to
 * stop propagation or editing a number would navigate away mid-edit.
 *
 * Clearing sets the override to null, which falls back to the global default —
 * not to unlimited. The tempting reading of an empty box is "no limit", and
 * that would quietly remove the only guardrail on an account.
 */
function CapControl({ connection }: { connection?: ConnectionRecord }) {
  const { refresh } = useConnections();
  const [value, setValue] = useState<string>(
    connection?.dailyActionCap === null || connection?.dailyActionCap === undefined
      ? ""
      : String(connection.dailyActionCap)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!connection) return null;

  const dirty =
    value.trim() !== (connection.dailyActionCap === null ? "" : String(connection.dailyActionCap));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const trimmed = value.trim();
      const next = trimmed === "" ? null : Number(trimmed);
      if (next !== null && (!Number.isInteger(next) || next < 0)) {
        throw new Error("Cap must be a whole number, or blank for the default.");
      }
      await api.setConnectionCap(connection!.id, next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="mt-3 rounded-lg border border-border bg-black/20 p-2.5"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-micro text-muted">Daily cap</span>
        <Input
          value={value}
          inputMode="numeric"
          aria-label={`Daily action cap for ${connection.platformId}`}
          placeholder="default"
          className="h-7 w-20 py-0 text-micro"
          onChange={(event) => setValue(event.target.value)}
        />
        {dirty && (
          <Button type="button" size="sm" className="h-7 text-micro" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-micro text-muted">
        {connection.dailyActionCap === null
          ? "Using the global default. Blank keeps it."
          : connection.dailyActionCap === 0
            ? "Unlimited for this account."
            : `${connection.dailyActionCap} actions a day for this account.`}
      </p>
      {error && <p className="mt-1 text-micro text-danger">{error}</p>}
    </div>
  );
}
