import { randomUUID } from "node:crypto";
import { checkEnvelopes, recordSpend } from "./envelopes.js";
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

  // Checked before the chain call, so a blocked spend costs nothing — no gas,
  // no transaction. The on-chain allowance is the real enforcement, but it
  // fails after the money has moved and cannot express "per day". This fails
  // first, locally, and in the operator's own terms.
  const envelope = checkEnvelopes({
    rail: "wallet",
    amountMinor: input.amountMinor,
    currency: tokenCurrency(match.permission.token),
  });
  if (!envelope.allowed) {
    throw new Error(envelope.reason ?? "This spend is outside the wallet limit.");
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

  // Also to the shared ledger, so "what has Jarvis spent this month" is one
  // query rather than a union across every provider that moves money.
  recordSpend({
    rail: "wallet",
    amountMinor: input.amountMinor,
    currency: tokenCurrency(match.permission.token),
    reason: input.purposeLabel,
    externalRef: transactionHash,
  });

  return {
    id,
    purposeLabel: input.purposeLabel,
    amountMinor: input.amountMinor,
    token: match.permission.token,
    txHash: transactionHash,
    createdAt: now,
  };
}

/**
 * The currency an on-chain token is denominated in.
 *
 * Conservative by design: an unrecognised token returns its own address rather
 * than being assumed to be USDC. An envelope set in USDC then refuses it, which
 * is the safe failure — quietly treating an unknown token as dollars is how a
 * limit authorises the wrong amount.
 */
function tokenCurrency(token: string): string {
  return KNOWN_TOKENS[token.toLowerCase()] ?? token.toLowerCase();
}

/**
 * Whether the operator's wallet is one CDP can act for.
 *
 * Granting a permission is a transaction *from* the operator's wallet, so
 * something has to sign it. CDP can, but only for smart accounts inside this
 * project. A wallet created anywhere else — the Coinbase app, a different CDP
 * project — has to grant from its own interface, and nothing on this server can
 * do it on their behalf.
 *
 * Asked before the grant form is offered rather than after it fails: the error
 * CDP returns for a wallet it does not own is not one anybody could act on.
 */
export async function operatorWalletIsManaged(): Promise<boolean> {
  const creds = walletCreds();
  try {
    const { accounts } = await client(creds).evm.listSmartAccounts({});
    return accounts.some(
      (account) => account.address.toLowerCase() === creds.operatorAddress.toLowerCase()
    );
  } catch {
    // Unreachable or unauthorised is not the same as "not managed", but the
    // caller can do nothing differently either way, and claiming it is managed
    // would offer a grant form that cannot work.
    return false;
  }
}

/**
 * Grants Jarvis's spender address a bounded allowance on the operator's wallet.
 *
 * This is the whole safety model in one call: the on-chain contract enforces
 * the allowance and the period regardless of anything this server does later,
 * so even a fully compromised orchestrator cannot spend past what was signed
 * here.
 *
 * Deliberately narrow. The caller picks an amount, a period and an expiry;
 * everything else is fixed — USDC on Base, granted to Jarvis's own spender and
 * nothing else. A general "grant any permission" endpoint would let a bug or a
 * forged request authorise a different spender entirely, which is the single
 * mistake this design exists to prevent.
 */
export async function grantSpendPermission(input: {
  allowanceMinor: number;
  periodInDays: number;
  /** Days from now. The permission stops working after this regardless of allowance. */
  expiresInDays: number;
}): Promise<{ userOpHash: string }> {
  if (!Number.isSafeInteger(input.allowanceMinor) || input.allowanceMinor <= 0) {
    throw new Error("Allowance must be a positive whole number of minor units.");
  }
  if (!Number.isSafeInteger(input.periodInDays) || input.periodInDays <= 0) {
    throw new Error("The period must be a positive number of days.");
  }
  if (!Number.isSafeInteger(input.expiresInDays) || input.expiresInDays < input.periodInDays) {
    // An expiry inside the first period would mean the allowance never fully
    // resets — a limit that reads as "$50 a week" but is really "$50, once".
    throw new Error("The expiry must be at least one full period away.");
  }

  const creds = walletCreds();
  const cdp = client(creds);
  const spender = await cdp.evm.getOrCreateAccount({ name: SPENDER_ACCOUNT_NAME });

  const result = await cdp.evm.createSpendPermission({
    spendPermission: {
      account: creds.operatorAddress,
      spender: spender.address,
      token: "usdc",
      allowance: BigInt(input.allowanceMinor),
      periodInDays: input.periodInDays,
      end: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
    },
    network: "base",
  });

  return { userOpHash: result.userOpHash };
}

/**
 * Revokes a permission — the operator taking authority back.
 *
 * Checked against Jarvis's own spender first. Revoking is destructive and the
 * hash comes from the caller, so without this a stale or wrong hash could
 * revoke an unrelated permission on the operator's wallet, one Jarvis has no
 * business touching.
 */
export async function revokeSpendPermission(permissionHash: string): Promise<void> {
  const creds = walletCreds();
  const cdp = client(creds);
  const spender = await cdp.evm.getOrCreateAccount({ name: SPENDER_ACCOUNT_NAME });

  const { spendPermissions } = await cdp.evm.listSpendPermissions({ address: creds.operatorAddress });
  const match = spendPermissions.find((p) => p.permissionHash === permissionHash);
  if (!match) throw new Error("No such spend permission — it may already have been revoked.");
  if (match.permission.spender.toLowerCase() !== spender.address.toLowerCase()) {
    throw new Error("That permission was not granted to Jarvis, so Jarvis will not revoke it.");
  }

  await cdp.evm.revokeSpendPermission({
    address: creds.operatorAddress,
    permissionHash: permissionHash as `0x${string}`,
    network: "base",
  });
}

/**
 * Draws funds from the operator's wallet using whichever granted permission
 * can cover the amount.
 *
 * The permission hash is resolved here rather than asked for, because the
 * caller that matters is a language model. Making it list permissions and pass
 * a hash back adds a step whose only possible failure is a wrong hash — and a
 * wrong hash is either a confusing error or, worse, the wrong permission.
 *
 * Widest allowance first, so a small permission sitting alongside a large one
 * does not fail a spend the operator has plainly authorised. Expired ones are
 * skipped rather than attempted: the chain would reject them anyway, and paying
 * gas to be told so is worse than saying it here.
 *
 * Note what this does and does not do. Coinbase's spend permission moves tokens
 * from the operator's wallet to Jarvis's *own spender account* — there is no
 * recipient parameter, and there cannot be one. So this is a draw-down, not a
 * payment: Jarvis can take what it was authorised to take, and cannot send it
 * to a stranger, because the destination is fixed by the contract rather than
 * chosen here.
 */
export async function drawFromWallet(input: {
  purposeLabel: string;
  amountMinor: number;
}): Promise<WalletSpendRecord> {
  const permissions = await listGrantedPermissions();
  if (permissions.length === 0) {
    throw new Error(
      "No spend permission has been granted to Jarvis yet, so there is nothing to draw from. Grant one on the Crypto → Wallet page."
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const usable = permissions
    .filter((permission) => permission.end === 0 || permission.end > nowSeconds)
    .sort((a, b) => (BigInt(b.allowanceMinor) > BigInt(a.allowanceMinor) ? 1 : -1));

  if (usable.length === 0) {
    throw new Error("Every spend permission granted to Jarvis has expired. Grant a new one.");
  }

  return spendFromPermission({
    purposeLabel: input.purposeLabel,
    amountMinor: input.amountMinor,
    permissionHash: usable[0].permissionHash,
  });
}
