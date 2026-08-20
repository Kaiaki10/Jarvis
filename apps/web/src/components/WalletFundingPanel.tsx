"use client";

import { useEffect, useState } from "react";
import { Loader2, Wallet, Copy, Check } from "lucide-react";
import type { WalletPermission, WalletSpendRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// Base mainnet's native USDC — same contract this panel's server side treats
// as "USDC" for display (billing/walletFunding.ts's KNOWN_TOKENS).
const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID = 8453;
const USDC_DECIMALS = 6;

function formatAllowance(allowanceMinor: string, tokenLabel: string | null): string {
  const value = Number(BigInt(allowanceMinor)) / 10 ** USDC_DECIMALS;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenLabel ?? "tokens"}`;
}

export function WalletFundingPanel({ operatorAddress }: { operatorAddress: string }) {
  const [spenderAddress, setSpenderAddress] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<WalletPermission[] | null>(null);
  const [spends, setSpends] = useState<WalletSpendRecord[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [allowance, setAllowance] = useState("");
  const [periodDays, setPeriodDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [{ address }, perms, sp] = await Promise.all([
        api.getWalletSpenderAddress(),
        api.listWalletPermissions(),
        api.listWalletSpends(),
      ]);
      setSpenderAddress(address);
      setPermissions(perms);
      setSpends(sp);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyAddress() {
    if (!spenderAddress) return;
    navigator.clipboard.writeText(spenderAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function grantPermission() {
    const amount = Number(allowance);
    const days = Number(periodDays);
    if (!spenderAddress || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(days) || days <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const { createBaseAccountSDK } = await import("@base-org/account");
      const { requestSpendPermission } = await import("@base-org/account/spend-permission");
      const sdk = createBaseAccountSDK({ appName: "Jarvis" });
      const provider = sdk.getProvider();
      // Establishes the signing connection — this is what actually opens the
      // wallet prompt. The address it returns isn't required to match
      // `operatorAddress` for the call below to work, but a mismatch means
      // whichever wallet just connected isn't the one you told Jarvis to expect.
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts[0] && accounts[0].toLowerCase() !== operatorAddress.toLowerCase()) {
        throw new Error(
          `Connected wallet (${accounts[0]}) doesn't match the Smart Wallet address on file (${operatorAddress}). Reconnect with the right wallet, or update the address in your connection settings.`
        );
      }

      await requestSpendPermission({
        account: operatorAddress,
        spender: spenderAddress,
        token: USDC_BASE_ADDRESS,
        chainId: BASE_CHAIN_ID,
        allowance: BigInt(Math.round(amount * 10 ** USDC_DECIMALS)),
        periodInDays: days,
        provider,
      });

      setAllowance("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card elevation={1} className="mt-6">
      <CardHeader
        title="Spend permissions"
        description="Jarvis spends only within an allowance you grant from your own Coinbase Smart Wallet — it never holds a key."
        icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
      />
      <CardBody className="flex flex-col gap-4">
        {spenderAddress && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface/60 p-3">
            <div className="min-w-0 flex-1">
              <div className="text-micro text-muted">Jarvis's spender address — grant permissions to this one</div>
              <div className="mt-0.5 truncate font-mono text-label text-foreground">{spenderAddress}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={copyAddress}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}

        {error && <div className="text-label text-danger">{error}</div>}

        <div className="flex flex-col gap-2">
          {(permissions ?? []).map((p) => (
            <div key={p.permissionHash} className="rounded-lg border border-border bg-surface/50 p-3">
              <div className="text-label font-medium text-foreground">{formatAllowance(p.allowanceMinor, p.tokenLabel)}</div>
              <div className="text-micro text-muted">every {Math.round(p.periodSeconds / 86400)} day(s)</div>
            </div>
          ))}
          {permissions && permissions.length === 0 && (
            <p className="text-label text-muted">No permissions granted to Jarvis yet.</p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface/60 p-4">
          <div className="text-label font-medium text-foreground">Grant a new permission (USDC on Base)</div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:w-32">
              <label className="text-micro text-muted">Allowance (USDC)</label>
              <Input className="mt-1 text-label" type="number" min="1" placeholder="50" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
            </div>
            <div className="sm:w-28">
              <label className="text-micro text-muted">Every N days</label>
              <Input className="mt-1 text-label" type="number" min="1" placeholder="7" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} />
            </div>
            <Button size="sm" onClick={grantPermission} disabled={busy || !spenderAddress || !allowance}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Connect wallet & grant
            </Button>
          </div>
          <p className="mt-2 text-micro text-muted">
            Opens your wallet to sign. Jarvis never sees your wallet&apos;s private key — the allowance is enforced on-chain.
          </p>
        </div>

        {spends && spends.length > 0 && (
          <div>
            <div className="text-label font-medium text-foreground">Recent spends</div>
            <ul className="mt-2 flex flex-col gap-1.5">
              {spends.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-label text-muted">
                  <span>{s.purposeLabel}</span>
                  <span className="tabular-nums">{(s.amountMinor / 10 ** USDC_DECIMALS).toFixed(2)} USDC</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
