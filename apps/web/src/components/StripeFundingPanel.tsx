"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe as StripeClient, type StripeElements } from "@stripe/stripe-js";
import { Loader2, Eye, EyeOff, Trash2, CreditCard } from "lucide-react";
import type { StripeCardRecord, IssuingBalanceLine } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * `retrieveIssuingCard` is a real Stripe.js method (per Stripe's own current
 * docs) that the published `@stripe/stripe-js` v9.13.0 type declarations
 * don't yet include — Stripe.js itself loads live from Stripe's CDN, so the
 * npm package's types can lag behind what the running script actually
 * supports. Scoped to this one call rather than widening the whole client's
 * type.
 */
type StripeClientWithIssuing = StripeClient & {
  retrieveIssuingCard: (
    cardId: string,
    options: { ephemeralKeySecret: string; nonce: string }
  ) => Promise<unknown>;
};

function formatMinor(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

export function StripeFundingPanel({ publishableKey }: { publishableKey: string }) {
  const [balance, setBalance] = useState<IssuingBalanceLine[] | null>(null);
  const [cards, setCards] = useState<StripeCardRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purposeLabel, setPurposeLabel] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [b, c] = await Promise.all([api.getStripeBalance(), api.listStripeCards()]);
      setBalance(b);
      setCards(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function issueCard() {
    const minorLimit = Math.round(Number(monthlyLimit) * 100);
    if (!purposeLabel.trim() || !Number.isFinite(minorLimit) || minorLimit <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.issueStripeCard({ purposeLabel: purposeLabel.trim(), monthlyLimitMinor: minorLimit });
      setPurposeLabel("");
      setMonthlyLimit("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelCard(cardId: string) {
    setBusy(true);
    try {
      await api.cancelStripeCard(cardId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card elevation={1} className="mt-6">
      <CardHeader
        title="Cards"
        description="One virtual card per biller, backed by your Stripe balance. Jarvis never sees the card number — reveal it below and Stripe shows it directly."
        icon={<CreditCard className="h-4 w-4" strokeWidth={1.75} />}
      />
      <CardBody className="flex flex-col gap-4">
        {balance && (
          <div className="text-label text-muted">
            Issuing balance:{" "}
            {balance.length
              ? balance.map((b) => formatMinor(b.amount, b.currency)).join(", ")
              : formatMinor(0, "usd")}
          </div>
        )}

        {error && <div className="text-label text-danger">{error}</div>}

        <div className="flex flex-col gap-2">
          {(cards ?? []).map((c) => (
            <CardRow key={c.cardId} card={c} publishableKey={publishableKey} onCancel={() => cancelCard(c.cardId)} busy={busy} />
          ))}
          {cards && cards.length === 0 && <p className="text-label text-muted">No cards yet.</p>}
        </div>

        <div className="rounded-lg border border-border bg-surface/60 p-4">
          <div className="text-label font-medium text-foreground">Issue a new card</div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:flex-1">
              <label className="text-micro text-muted">Purpose</label>
              <Input
                className="mt-1 text-label"
                placeholder="Anthropic Console"
                value={purposeLabel}
                onChange={(e) => setPurposeLabel(e.target.value)}
              />
            </div>
            <div className="sm:w-40">
              <label className="text-micro text-muted">Monthly limit (USD)</label>
              <Input
                className="mt-1 text-label"
                type="number"
                min="1"
                placeholder="200"
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={issueCard} disabled={busy || !purposeLabel.trim() || !monthlyLimit}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Issue card
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function CardRow({
  card,
  publishableKey,
  onCancel,
  busy,
}: {
  card: StripeCardRecord;
  publishableKey: string;
  onCancel: () => void;
  busy: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const numberRef = useRef<HTMLDivElement>(null);
  const cvcRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<StripeElements | null>(null);

  async function reveal() {
    setRevealing(true);
    setRevealError(null);
    try {
      const stripe = (await loadStripe(publishableKey)) as StripeClientWithIssuing | null;
      if (!stripe) throw new Error("Stripe.js failed to load.");

      const nonceResult = await stripe.createEphemeralKeyNonce({ issuingCard: card.cardId });
      if (nonceResult.error) throw new Error(nonceResult.error.message ?? "Could not create an ephemeral key nonce.");
      const nonce = nonceResult.nonce;
      const { ephemeralKeySecret } = await api.createStripeRevealSession(card.cardId, { nonce });
      await stripe.retrieveIssuingCard(card.cardId, { ephemeralKeySecret, nonce });

      const elements = stripe.elements();
      elementsRef.current = elements;
      setRevealed(true);
      // Mount happens after the containers exist — next tick, once `revealed` renders them.
      queueMicrotask(() => {
        if (numberRef.current) {
          elements.create("issuingCardNumberDisplay", { issuingCard: card.cardId, nonce, ephemeralKeySecret }).mount(numberRef.current);
        }
        if (cvcRef.current) {
          elements.create("issuingCardCvcDisplay", { issuingCard: card.cardId, nonce, ephemeralKeySecret }).mount(cvcRef.current);
        }
        if (expiryRef.current) {
          elements.create("issuingCardExpiryDisplay", { issuingCard: card.cardId, nonce, ephemeralKeySecret }).mount(expiryRef.current);
        }
      });
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-label font-medium text-foreground">{card.purposeLabel}</div>
          <div className="text-micro text-muted">
            {card.brand} •••• {card.last4} · {card.status}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!revealed && (
            <Button size="sm" variant="secondary" onClick={reveal} disabled={revealing || card.status !== "active"}>
              {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Reveal
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy || card.status === "inactive"}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {revealError && <div className="mt-2 text-micro text-danger">{revealError}</div>}
      {revealed && (
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md border border-border bg-surface p-3">
          <div className="flex items-center gap-1.5 text-micro text-muted">
            <EyeOff className="h-3 w-3" /> Rendered directly by Stripe — never visible to Jarvis
          </div>
          <div ref={numberRef} className="h-6 min-w-32" />
          <div ref={expiryRef} className="h-6 w-16" />
          <div ref={cvcRef} className="h-6 w-12" />
        </div>
      )}
    </div>
  );
}
