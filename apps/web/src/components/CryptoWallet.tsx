"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, ExternalLink, Loader2, ShieldCheck, Wallet } from "lucide-react";
import type { SpendEnvelopeRecord, WalletPermission, WalletSpendRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatMoney } from "@/lib/money";

/** Base mainnet USDC, the only token Jarvis names rather than shows as an address. */
const TOKEN_LABEL: Record<string, string> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
};

function tokenLabel(token: string): string {
  return TOKEN_LABEL[token.toLowerCase()] ?? `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function CryptoWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<WalletPermission[] | null>(null);
  const [envelope, setEnvelope] = useState<SpendEnvelopeRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [spender, granted, spend] = await Promise.all([
          api.getWalletSpenderAddress(),
          api.listWalletPermissions(),
          api.getSpend(),
        ]);
        setAddress(spender.address);
        setPermissions(granted);
        setEnvelope(spend.envelopes.find((e) => e.rail === "wallet") ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPermissions([]);
      }
    })();
  }, []);

  if (!permissions) {
    return (
      <Card>
        <div className="flex items-center gap-2 px-5 py-12 text-body text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
          Reading the wallet…
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
          <Wallet className="h-5 w-5 text-muted" strokeWidth={1.75} />
          <div className="text-body text-muted">Coinbase Wallet is not connected.</div>
          <Link
            href="/under-the-hood/connections/coinbase"
            className="text-label font-medium text-foreground hover:underline"
          >
            Connect it
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-micro uppercase tracking-[0.14em] text-muted">Spender address</div>
            <div className="mt-1 truncate font-mono text-label text-foreground">{address ?? "—"}</div>
            {/* The distinction that matters: Jarvis holds no key. It can only
                spend inside a permission the operator signed. */}
            <p className="mt-2 max-w-xl text-label leading-relaxed text-muted">
              Jarvis never holds a private key. It can only spend within a permission you have
              signed to this address, which the chain enforces regardless of anything here.
            </p>
          </div>
          <div className="text-right">
            <div className="text-micro uppercase tracking-[0.14em] text-muted">Jarvis&apos;s own limit</div>
            <div className="mt-1 text-body font-medium text-foreground">
              {envelope ? `${formatMoney(envelope.limitMinor, envelope.currency)} / day` : "Closed"}
            </div>
            <Link
              href="/under-the-hood/money/budgets"
              className="mt-1 inline-flex items-center gap-1 text-micro text-muted hover:text-foreground"
            >
              Change <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            </Link>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-success" strokeWidth={1.75} />
          <div className="text-label font-medium text-foreground">Granted permissions</div>
        </div>
        {permissions.length === 0 ? (
          <div className="px-5 py-10 text-center text-body text-muted">
            No permissions granted to Jarvis yet. Nothing can be spent.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {permissions.map((permission) => (
              <div key={permission.permissionHash} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Coins className="h-4 w-4 shrink-0 text-accent-bright" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="text-label font-medium text-foreground">
                    {permission.tokenLabel ?? tokenLabel(permission.token)}
                  </div>
                  <div className="text-micro text-muted">
                    allowance {permission.allowanceMinor} minor units · resets every{" "}
                    {Math.round(permission.periodSeconds / 3600)}h
                  </div>
                </div>
                <Badge tone="neutral">on-chain</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function CryptoSpending() {
  const [spends, setSpends] = useState<WalletSpendRecord[] | null>(null);

  useEffect(() => {
    void api
      .listWalletSpends()
      .then(setSpends)
      .catch(() => setSpends([]));
  }, []);

  if (!spends) {
    return (
      <Card>
        <div className="flex items-center gap-2 px-5 py-12 text-body text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
          Loading…
        </div>
      </Card>
    );
  }

  if (spends.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
          <Coins className="h-5 w-5 text-muted" strokeWidth={1.75} />
          <div className="text-body text-muted">Nothing spent on-chain yet.</div>
          <p className="max-w-sm text-label text-muted">
            Wallet spends appear here and in the shared ledger under Money.
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
              <th className="px-5 py-3 font-semibold">What for</th>
              <th className="px-5 py-3 font-semibold">Transaction</th>
              <th className="px-5 py-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {spends.map((spend) => (
              <tr key={spend.id} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-5 py-3 text-label text-muted">
                  {new Date(spend.createdAt).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </td>
                <td className="px-5 py-3 text-label text-foreground-secondary">{spend.purposeLabel}</td>
                <td className="px-5 py-3 font-mono text-micro text-muted">
                  {spend.txHash ? (
                    <a
                      href={`https://basescan.org/tx/${spend.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {spend.txHash.slice(0, 10)}…
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-label font-medium text-foreground tabular-nums">
                  {formatMoney(spend.amountMinor, spend.token === "" ? "USDC" : tokenLabel(spend.token))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
