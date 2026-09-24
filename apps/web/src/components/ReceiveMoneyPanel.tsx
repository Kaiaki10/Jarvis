"use client";

import { useEffect, useState } from "react";
import { Banknote, Copy, Check, Loader2 } from "lucide-react";
import type { MoneyReceiptRecord, StripePaymentLinkRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";

function formatMinor(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Money-in: Stripe Payment Links plus the receipts confirmed by Stripe's
 * signed webhooks. Creating a link authorises no spend — checkout happens
 * on Stripe's hosted page — and a receipt appears only when a checkout
 * completes, never when a link is created or clicked.
 */
export function ReceiveMoneyPanel() {
  const [links, setLinks] = useState<StripePaymentLinkRecord[] | null>(null);
  const [receipts, setReceipts] = useState<MoneyReceiptRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "GBP">("GBP");
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function refresh() {
    try {
      const [l, r] = await Promise.all([api.listPaymentLinks(), api.listMoneyReceipts()]);
      setLinks(l);
      setReceipts(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listPaymentLinks(), api.listMoneyReceipts()])
      .then(([l, r]) => {
        if (cancelled) return;
        setLinks(l);
        setReceipts(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createLink() {
    // Major units on screen, minor units on the wire — converted here rather
    // than left to the caller, the same way the card panel converts its
    // limit field. USD and GBP both run 100 minor units to the major one.
    const amountMinor = Math.round(Number(amount) * 100);
    if (!label.trim() || !Number.isFinite(amountMinor) || amountMinor <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPaymentLink({ label: label.trim(), amountMinor, currency });
      setLabel("");
      setAmount("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      setError("Could not copy — select the URL by hand instead.");
    }
  }

  const totalsByCurrency = new Map<string, number>();
  for (const r of receipts ?? []) {
    totalsByCurrency.set(r.currency, (totalsByCurrency.get(r.currency) ?? 0) + r.amountMinor);
  }
  const totals = [...totalsByCurrency.entries()]
    .map(([code, minor]) => formatMinor(minor, code))
    .join(" + ");

  return (
    <Card elevation={1} className="mt-6">
      <CardHeader
        title="Receive"
        description="Payment links to share with payers, and the receipts Stripe confirms. Nothing counts as revenue until a checkout completes."
        icon={<Banknote className="h-4 w-4" strokeWidth={1.75} />}
      />
      <CardBody className="flex flex-col gap-4">
        {receipts && receipts.length > 0 && (
          <div className="text-label text-muted">
            Received: {totals} across {receipts.length}{" "}
            {receipts.length === 1 ? "payment" : "payments"}
          </div>
        )}

        {error && <div className="text-label text-danger">{error}</div>}

        <div className="flex flex-col gap-2">
          {(links ?? []).map((link) => (
            <div key={link.id} className="rounded-lg border border-border bg-surface/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-label font-medium text-foreground">{link.label}</div>
                  <div className="text-micro text-muted">
                    {formatMinor(link.amountMinor, link.currency)} · {link.status}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => copyUrl(link.id, link.url)}>
                  {copiedId === link.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedId === link.id ? "Copied" : "Copy link"}
                </Button>
              </div>
            </div>
          ))}
          {links && links.length === 0 && <p className="text-label text-muted">No payment links yet.</p>}
        </div>

        <div className="rounded-lg border border-border bg-surface/60 p-4">
          <div className="text-label font-medium text-foreground">Create a payment link</div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:flex-1">
              <label className="text-micro text-muted">What it pays for</label>
              <Input
                className="mt-1 text-label"
                placeholder="October content retainer"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="sm:w-40">
              <label className="text-micro text-muted">Amount</label>
              <Input
                className="mt-1 text-label"
                type="number"
                min="1"
                step="0.01"
                placeholder="250.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="sm:w-28">
              <label className="text-micro text-muted">Currency</label>
              <Select
                aria-label="Link currency"
                className="mt-1 text-label"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "USD" | "GBP")}
              >
                <option value="GBP">GBP £</option>
                <option value="USD">USD $</option>
              </Select>
            </div>
            <Button size="sm" onClick={createLink} disabled={busy || !label.trim() || !amount}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create link
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-label font-medium text-foreground">Receipts</div>
          {(receipts ?? []).map((receipt) => (
            <div key={receipt.id} className="rounded-lg border border-border bg-surface/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-label font-medium text-foreground">
                  {formatMinor(receipt.amountMinor, receipt.currency)}
                </div>
                <div className="text-micro text-muted">{formatDate(receipt.createdAt)}</div>
              </div>
              {receipt.email && <div className="mt-0.5 text-micro text-muted">{receipt.email}</div>}
            </div>
          ))}
          {receipts && receipts.length === 0 && (
            <p className="text-label text-muted">No payments received yet.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
