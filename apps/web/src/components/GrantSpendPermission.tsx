"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Crossfade } from "@/components/motion";
import { parseAmount, formatMoney } from "@/lib/money";

/** Offered periods, in days. A weekly allowance is the one most people want. */
const PERIODS: Array<{ days: number; label: string }> = [
  { days: 1, label: "a day" },
  { days: 7, label: "a week" },
  { days: 30, label: "a month" },
];

/**
 * Granting Jarvis a bounded allowance — the step that arms the crypto rail.
 *
 * Until this existed, Jarvis had a spender address and the ability to spend,
 * and no way to be given anything to spend: the setup wizard described a panel
 * here that had never been built, so the only route was to grant the permission
 * outside Jarvis entirely.
 *
 * What is being authorised is worth stating plainly on the page, so the two
 * facts that matter are visible at the moment of deciding: the allowance
 * refills every period rather than being a one-off, and the chain enforces it
 * rather than Jarvis's own judgement.
 */
export function GrantSpendPermission({ onGranted }: { onGranted: () => Promise<void> }) {
  const [canGrant, setCanGrant] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("25");
  const [periodInDays, setPeriodInDays] = useState(7);
  const [expiresInDays, setExpiresInDays] = useState(365);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getWalletGrantCapability()
      .then(({ canGrant: allowed }) => setCanGrant(allowed))
      .catch(() => setCanGrant(false));
  }, []);

  const allowanceMinor = parseAmount(amount, "USDC");

  async function grant() {
    if (allowanceMinor === null || allowanceMinor <= 0) {
      setError("Enter an amount to authorise.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.grantWalletPermission({ allowanceMinor, periodInDays, expiresInDays });
      await onGranted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (canGrant === null) {
    return (
      <Card>
        <div className="flex items-center gap-2 px-5 py-8 text-body text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
          Checking your wallet…
        </div>
      </Card>
    );
  }

  /**
   * Granting is a transaction from the operator's wallet, and only Coinbase can
   * sign for a wallet it holds. Said here rather than left as a failed submit,
   * because the fix is somewhere else entirely and no error from the API would
   * point at it.
   */
  if (!canGrant) {
    return (
      <Card>
        <CardHeader
          title="Grant an allowance"
          description="Jarvis can only spend inside a permission you sign."
          icon={<KeyRound className="h-4 w-4" strokeWidth={1.75} />}
        />
        <div className="flex items-start gap-3 px-5 pb-5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
          <div className="text-label leading-relaxed text-foreground-secondary">
            <p>
              This wallet is not one Coinbase can sign for from here — it was created outside
              this CDP project, so granting has to happen in the wallet&apos;s own interface.
            </p>
            <p className="mt-2 text-muted">
              Grant the permission to Jarvis&apos;s spender address shown above, and it will
              appear here once it is on-chain. Alternatively, use a Smart Wallet created in
              this CDP project and Jarvis can do it from this page.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Grant an allowance"
        description="A bounded permission to Jarvis's spender address, enforced on-chain."
        icon={<KeyRound className="h-4 w-4" strokeWidth={1.75} />}
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-32 flex-1">
            <span className="mb-1.5 block text-micro text-muted">Allowance · USDC</span>
            <Input
              value={amount}
              inputMode="decimal"
              placeholder="25"
              className="w-full"
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="min-w-32 flex-1">
            <span className="mb-1.5 block text-micro text-muted">Refills every</span>
            <Select
              className="w-full"
              value={String(periodInDays)}
              onChange={(event) => setPeriodInDays(Number(event.target.value))}
            >
              {PERIODS.map((period) => (
                <option key={period.days} value={period.days} className="bg-surface">
                  {period.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="min-w-32 flex-1">
            <span className="mb-1.5 block text-micro text-muted">Expires after</span>
            <Select
              className="w-full"
              value={String(expiresInDays)}
              onChange={(event) => setExpiresInDays(Number(event.target.value))}
            >
              {[30, 90, 180, 365, 730].map((days) => (
                <option key={days} value={days} className="bg-surface">
                  {days} days
                </option>
              ))}
            </Select>
          </label>
        </div>

        {/* Said in one sentence, in the operator's own terms, because "allowance
            per period" is the detail people misread as a one-off total. */}
        <p className="text-label leading-relaxed text-muted">
          Jarvis will be able to spend up to{" "}
          <strong className="font-medium text-foreground">
            {allowanceMinor === null ? "—" : formatMoney(allowanceMinor, "USDC")}
          </strong>{" "}
          every {PERIODS.find((p) => p.days === periodInDays)?.label ?? `${periodInDays} days`},
          refilling each period, until it expires. The chain enforces this — not Jarvis. You can
          revoke it at any time, and your own daily limit under Money applies on top.
        </p>

        <Crossfade viewKey={error ? "error" : "idle"}>
          {error ? (
            <p className="text-label text-danger">{error}</p>
          ) : (
            <span className="sr-only">No errors</span>
          )}
        </Crossfade>

        <div className="flex justify-end">
          <Button type="button" disabled={busy || allowanceMinor === null} onClick={() => void grant()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />}
            {busy ? "Granting…" : "Grant permission"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
