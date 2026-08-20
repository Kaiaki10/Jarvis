import { randomUUID } from "node:crypto";
import { CdpClient } from "@coinbase/cdp-sdk";
import type { WalletPermission, WalletSpendRecord } from "@jarvis/shared";
import { db } from "../db/db.js";
import { getConnectionCredentials } from "../db/connectionsRepo.js";

/**
 * Jarvis never holds a wallet private key — Coinbase's infrastructure does,
 * for both the operator's own Smart Wallet and the spender identity Jarvis
 * controls via the CDP API. What Jarvis can do is spend within whatever
 * Spend Permission the operator has signed and granted to that spender
 * address, which the on-chain contract enforces regardless of anything this
 * code does or doesn't check.
 */

const SPENDER_ACCOUNT_NAME = "jarvis-spender";

/** Matches viem's own `Address` shape without depending on viem directly — it's only a transitive dependency here, via the CDP SDK. */
type Address = `0x${string}`;

// Base mainnet's native USDC (Circle-issued), not the older bridged USDbC —
// verified against BaseScan/Circle's own contract-address docs, not guessed.
const KNOWN_TOKENS: Record<string, string> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
};

interface WalletCreds {
  cdpApiKeyId: string;
  cdpApiKeySecret: string;
  cdpWalletSecret: string;
  operatorAddress: Address;
}

function walletCreds(): WalletCreds {
  const creds = getConnectionCredentials("coinbase");
  if (!creds?.cdpApiKeyId || !creds.cdpApiKeySecret || !creds.cdpWalletSecret || !creds.operatorAddress) {
    throw new Error("Coinbase Wallet is not connected yet — add your CDP credentials and Smart Wallet address first.");
  }
  return {
    cdpApiKeyId: creds.cdpApiKeyId,
    cdpApiKeySecret: creds.cdpApiKeySecret,
    cdpWalletSecret: creds.cdpWalletSecret,
    operatorAddress: creds.operatorAddress as Address,
  };
}

function client(creds: WalletCreds): CdpClient {
  return new CdpClient({
    apiKeyId: creds.cdpApiKeyId,
    apiKeySecret: creds.cdpApiKeySecret,
    walletSecret: creds.cdpWalletSecret,
  });
}

/** Creates Jarvis's spender identity on first call, returns its address on every call after. */
export async function getSpenderAddress(): Promise<string> {
  const creds = walletCreds();
  const spender = await client(creds).evm.getOrCreateAccount({ name: SPENDER_ACCOUNT_NAME });
  return spender.address;
}

/** Every permission the operator has granted to Jarvis's spender address specifically — not every permission on their wallet. */
export async function listGrantedPermissions(): Promise<WalletPermission[]> {
  const creds = walletCreds();
  const cdp = client(creds);
  const spenderAddress = await getSpenderAddress();
  const { spendPermissions } = await cdp.evm.listSpendPermissions({ address: creds.operatorAddress });
  return spendPermissions
    .filter((p) => p.permission.spender.toLowerCase() === spenderAddress.toLowerCase())
    .map((p) => ({
      permissionHash: p.permissionHash,
      token: p.permission.token,
      tokenLabel: KNOWN_TOKENS[p.permission.token.toLowerCase()] ?? null,
      allowanceMinor: p.permission.allowance.toString(),
      periodSeconds: p.permission.period,
      start: p.permission.start,
      end: p.permission.end,
    }));
}

interface SpendRow {
  id: string;
  purpose_label: string;
  amount_minor: number;
  token: string;
  tx_hash: string | null;
  created_at: string;
}

function mapSpend(row: SpendRow): WalletSpendRecord {
  return {
    id: row.id,
    purposeLabel: row.purpose_label,
    amountMinor: row.amount_minor,
    token: row.token,
    txHash: row.tx_hash,
    createdAt: row.created_at,
  };
}

export function listWalletSpends(): WalletSpendRecord[] {
  const rows = db.prepare("SELECT * FROM wallet_spends ORDER BY created_at DESC").all() as unknown as SpendRow[];
  return rows.map(mapSpend);
}

/**
 * Spends within an already-granted permission. Re-fetches the permission
 * from the chain rather than trusting a client-supplied token/allowance, and
 * confirms it was actually granted to Jarvis's own spender address — the
 * on-chain contract would reject a mismatch anyway, but failing here first
 * gives a clear error instead of an opaque transaction revert.
 */
export async function spendFromPermission(input: {
  purposeLabel: string;
  amountMinor: number;
  permissionHash: string;
}): Promise<WalletSpendRecord> {
  const creds = walletCreds();
  const cdp = client(creds);
  const spender = await cdp.evm.getOrCreateAccount({ name: SPENDER_ACCOUNT_NAME });

  const { spendPermissions } = await cdp.evm.listSpendPermissions({ address: creds.operatorAddress });
  const match = spendPermissions.find((p) => p.permissionHash === input.permissionHash);
  if (!match) throw new Error("No such spend permission — it may have been revoked.");
  if (match.permission.spender.toLowerCase() !== spender.address.toLowerCase()) {
    throw new Error("This permission was not granted to Jarvis's spender address.");
  }

  const { transactionHash } = await spender.useSpendPermission({
    spendPermission: match.permission,
    value: BigInt(input.amountMinor),
    network: "base",
  });

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO wallet_spends (id, purpose_label, amount_minor, token, tx_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.purposeLabel, input.amountMinor, match.permission.token, transactionHash, now);

  return {
    id,
    purposeLabel: input.purposeLabel,
    amountMinor: input.amountMinor,
    token: match.permission.token,
    txHash: transactionHash,
    createdAt: now,
  };
}
