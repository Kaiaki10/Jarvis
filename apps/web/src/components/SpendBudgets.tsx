"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2, Lock, Megaphone, ShieldCheck, Trash2, Wallet } from "lucide-react";
import type { SpendEnvelopeRecord, SpendLedgerEntry, SpendPeriod, SpendRail } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { formatMoney, parseAmount, toInputValue } from "@/lib/money";

const RAILS: Array<{
  rail: SpendRail;
  label: string;
  icon: typeof Wallet;
  blurb: string;
  /** The currency this rail actually moves in, so the field is not a guess. */
  currency: string;
  period: SpendPeriod;
}> = [
  {
    rail: "wallet",
    label: "Crypto wallet",
    icon: Wallet,
    blurb: "Spent directly on-chain. Checked before the transaction, so a refusal costs no gas.",
    currency: "USDC",
    period: "day",
  },
  {
    rail: "card",
    label: "Cards",
    icon: CreditCard,
    blurb: "Total authority across live cards. Stripe enforces each card; this bounds how many.",
    currency: "USD",
    period: "month",
  },
  {
    rail: "ad_budget",
    label: "Advertising",
    icon: Megaphone,
    blurb: "Total daily commitment across live campaigns, which no single ad platform sees.",
    currency: "USD",
    period: "day",
  },
];

export function SpendBudgets() {
  const [envelopes, setEnvelopes] = useState<SpendEnvelopeRecord[] | null>(null);
  const [ledger, setLedger] = useState<SpendLedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const spend = await api.getSpend();
      setEnvelopes(spend.envelopes);
      setLedger(spend.ledger);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const spentByRail = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of ledger) {
      const key = `${entry.rail}:${entry.currency}`;
      totals.set(key, (totals.get(key) ?? 0) + entry.amountMinor);
    }
    return totals;
  }, [ledger]);

  if (!envelopes) {
    return (
      <Card>
        <div className="flex items-center gap-2 px-5 py-12 text-body text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
          Loading limits…
        </div>
      </Card>
    );
  }

  const unset = RAILS.filter((r) => !envelopes.some((e) => e.rail === r.rail)).length;

  return (
    <div className="space-y-4">
      <Card elevation={0} className="flex flex-wrap items-center gap-3 px-5 py-4">
        <ShieldCheck className="h-4 w-4 shrink-0 text-success" strokeWidth={1.75} />
        <p className="min-w-0 flex-1 text-label leading-relaxed text-foreground-secondary">
          A rail with no limit <strong className="font-medium text-foreground">will not spend at all</strong>.
          Setting a limit is what turns a paid capability on, rather than a ceiling on
          something already running.
        </p>
        {unset > 0 && (
          <Badge tone="neutral">
            {unset} of {RAILS.length} rail{unset === 1 ? "" : "s"} closed
          </Badge>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {RAILS.map((rail) => (
          <RailCard
            key={rail.rail}
            spec={rail}
            envelope={envelopes.find((e) => e.rail === rail.rail) ?? null}
            spentMinor={spentByRail.get(`${rail.rail}:${rail.currency}`) ?? 0}
            onChanged={load}
          />
        ))}
      </div>

      {error && <p className="text-label text-danger">{error}</p>}
    </div>
  );
}

function RailCard({
  spec,
  envelope,
  spentMinor,
  onChanged,
}: {
  spec: (typeof RAILS)[number];
  envelope: SpendEnvelopeRecord | null;
  spentMinor: number;
  onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState(envelope ? toInputValue(envelope.limitMinor, envelope.currency) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = spec.icon;

  // Only meaningful for the wallet today: cards and ads bound authorised
  // capacity, which the ledger of completed spends does not measure.
  const showsUsage = spec.rail === "wallet" && envelope !== null;
  const used = envelope && envelope.limitMinor > 0 ? Math.min(1, spentMinor / envelope.limitMinor) : 0;
  const nearLimit = used >= 0.8;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const limitMinor = parseAmount(value, spec.currency);
    if (limitMinor === null) {
      setError("Enter an amount, or remove the limit to close the rail.");
      return;
    }
    await act(() =>
      api.setSpendEnvelope({
        rail: spec.rail,
        period: spec.period,
        limitMinor,
        currency: spec.currency,
      })
    );
  }

  return (
    <Card elevation={envelope ? 1 : 0} className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              envelope ? "bg-accent/10" : "bg-white/[0.04]"
            }`}
          >
            {envelope ? (
              <Icon className="h-4 w-4 text-accent-bright" strokeWidth={1.75} />
            ) : (
              <Lock className="h-4 w-4 text-muted" strokeWidth={1.75} />
            )}
          </div>
          <div>
            <div className="text-body font-medium text-foreground">{spec.label}</div>
            <div className="text-micro text-muted">
              per {spec.period === "day" ? "day" : "month"} · {spec.currency}
            </div>
          </div>
        </div>
        {envelope ? (
          <Badge tone={nearLimit ? "warning" : "success"} dot>
            Open
          </Badge>
        ) : (
          <Badge tone="neutral">Closed</Badge>
        )}
      </div>

      <p className="mt-3 min-h-[2.5rem] text-label leading-relaxed text-muted">{spec.blurb}</p>

      {showsUsage && envelope && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                nearLimit ? "bg-warning" : "bg-accent"
              }`}
              style={{ width: `${Math.round(used * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 text-micro text-muted">
            {formatMoney(spentMinor, envelope.currency)} of{" "}
            {formatMoney(envelope.limitMinor, envelope.currency)} today
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Input
          value={value}
          inputMode="decimal"
          aria-label={`${spec.label} limit in ${spec.currency}`}
          placeholder={`0 ${spec.currency}`}
          className="h-8 flex-1 py-0 text-label"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="button" size="sm" className="h-8" disabled={busy} onClick={() => void save()}>
          {busy ? "…" : envelope ? "Update" : "Open"}
        </Button>
        {envelope && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted hover:text-danger"
            aria-label={`Remove the ${spec.label} limit`}
            disabled={busy}
            onClick={() => void act(() => api.removeSpendEnvelope(envelope.id))}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        )}
      </div>

      {/* Removing is not "unlimited" — it closes the rail. Said plainly, because
          the opposite reading is the dangerous one. */}
      {envelope && (
        <p className="mt-2 text-micro text-muted">
          Removing this limit closes the rail — it does not make it unlimited.
        </p>
      )}
      {error && <p className="mt-2 text-micro text-danger">{error}</p>}
    </Card>
  );
}

/** Reads the same data, so the two surfaces cannot disagree about a total. */
export function SpendLedgerTable() {
  const [ledger, setLedger] = useState<SpendLedgerEntry[] | null>(null);

  useEffect(() => {
    void api
      .getSpend()
      .then((spend) => setLedger(spend.ledger))
      .catch(() => setLedger([]));
  }, []);

  if (!ledger) {
    return (
      <Card>
        <div className="flex items-center gap-2 px-5 py-12 text-body text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
          Loading…
        </div>
      </Card>
    );
  }

  if (ledger.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
          <Wallet className="h-5 w-5 text-muted" strokeWidth={1.75} />
          <div className="text-body text-muted">Jarvis hasn&apos;t spent anything yet.</div>
          <p className="max-w-sm text-label text-muted">
            Every spend lands here whatever rail it moved over, so this is the whole picture
            rather than one provider&apos;s view.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-micro uppercase tracking-[0.14em] text-muted">
              <th className="px-5 py-3 font-semibold">When</th>
              <th className="px-5 py-3 font-semibold">Rail</th>
              <th className="px-5 py-3 font-semibold">What for</th>
              <th className="px-5 py-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((entry) => (
              <tr key={entry.id} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-5 py-3 text-label text-muted">
                  {new Date(entry.createdAt).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </td>
                <td className="px-5 py-3">
                  <Badge tone="neutral">{entry.rail.replace("_", " ")}</Badge>
                </td>
                <td className="px-5 py-3 text-label text-foreground-secondary">{entry.reason}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-label font-medium text-foreground tabular-nums">
                  {formatMoney(entry.amountMinor, entry.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
