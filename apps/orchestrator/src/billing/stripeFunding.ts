import Stripe from "stripe";
import { checkCapacity } from "./envelopes.js";
import type { IssuingBalanceLine, StripeCardRecord } from "@jarvis/shared";
import { db } from "../db/db.js";
import { getConnectionCredentials } from "../db/connectionsRepo.js";

/**
 * Jarvis never moves money and never sees a PAN or CVC — it only reads
 * balance, issues/cancels cards, and mints short-lived reveal sessions that
 * Stripe's own Issuing Elements use directly in the browser. Funding the
 * Stripe balance itself (bank transfer, Stripe's crypto onramp, whatever)
 * happens entirely on Stripe's side; nothing here initiates a transfer.
 */

interface CardRow {
  card_id: string;
  purpose_label: string;
  brand: string;
  last4: string;
  status: string;
  created_at: string;
}

function mapCard(row: CardRow): StripeCardRecord {
  return {
    cardId: row.card_id,
    purposeLabel: row.purpose_label,
    brand: row.brand,
    last4: row.last4,
    status: row.status,
    createdAt: row.created_at,
  };
}

function stripeCreds(): { secretKey: string; cardholderId: string } {
  const creds = getConnectionCredentials("stripe");
  if (!creds?.secretKey || !creds.cardholderId) {
    throw new Error("Stripe is not connected yet — add a restricted API key and Cardholder ID first.");
  }
  return { secretKey: creds.secretKey, cardholderId: creds.cardholderId };
}

function client(): Stripe {
  return new Stripe(stripeCreds().secretKey);
}

/** The balance Jarvis-issued cards can actually draw on — Stripe's own Issuing-specific balance line, not the account's general balance. */
export async function getIssuingBalance(): Promise<IssuingBalanceLine[]> {
  const balance = await client().balance.retrieve();
  return (balance.issuing?.available ?? []).map((line) => ({
    amount: line.amount,
    currency: line.currency,
  }));
}

export function listStripeCards(): StripeCardRecord[] {
  const rows = db.prepare("SELECT * FROM stripe_cards ORDER BY created_at ASC").all() as unknown as CardRow[];
  return rows.map(mapCard);
}

export async function issueStripeCard(input: {
  purposeLabel: string;
  monthlyLimitMinor: number;
}): Promise<StripeCardRecord> {
  const { cardholderId } = stripeCreds();

  // Checked before the card exists, so a refusal leaves nothing to clean up.
  // Capacity rather than spend: Stripe enforces each card's limit at swipe
  // time, but nothing stops Jarvis issuing a tenth card — the envelope bounds
  // the total authority handed out, which is the number Stripe never sees.
  const committed = activeCardCapacityMinor();
  const capacity = checkCapacity({
    rail: "card",
    committedMinor: committed,
    addingMinor: input.monthlyLimitMinor,
    currency: "USD",
    period: "month",
  });
  if (!capacity.allowed) {
    throw new Error(capacity.reason ?? "This card is outside the card spending limit.");
  }

  const card = await client().issuing.cards.create({
    cardholder: cardholderId,
    currency: "usd",
    type: "virtual",
    status: "active",
    // The real guardrail lives here, enforced by Stripe at authorization
    // time — not duplicated as a local estimate the way spendGuard.ts
    // pre-flights ad-platform actions, since Stripe already does this
    // authoritatively for every swipe.
    spending_controls: {
      // Omitting categories applies the limit to all of them.
      spending_limits: [{ amount: input.monthlyLimitMinor, interval: "monthly" }],
    },
  });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO stripe_cards (card_id, purpose_label, monthly_limit_minor, brand, last4, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(card.id, input.purposeLabel, input.monthlyLimitMinor, card.brand, card.last4, card.status, now);
  return { cardId: card.id, purposeLabel: input.purposeLabel, brand: card.brand, last4: card.last4, status: card.status, createdAt: now };
}

/** Stripe has no real card deletion — this is the standard way to permanently retire one. */
export async function cancelStripeCard(cardId: string): Promise<void> {
  await client().issuing.cards.update(cardId, { status: "inactive" });
  db.prepare("UPDATE stripe_cards SET status = 'inactive' WHERE card_id = ?").run(cardId);
}

/**
 * A short-lived (15-minute) key Stripe.js uses in the browser to reveal a
 * card's number/CVC directly from Stripe — never through this server. Only
 * ever issued for a card Jarvis itself created and is tracking, not an
 * arbitrary Stripe card id a caller might supply.
 */
export async function createCardRevealSession(
  cardId: string,
  nonce: string
): Promise<{ ephemeralKeySecret: string }> {
  const tracked = db.prepare("SELECT 1 FROM stripe_cards WHERE card_id = ?").get(cardId);
  if (!tracked) throw new Error("Unknown card.");
  const key = await client().ephemeralKeys.create(
    { nonce, issuing_card: cardId },
    { apiVersion: Stripe.API_VERSION }
  );
  if (!key.secret) throw new Error("Stripe did not return an ephemeral key.");
  return { ephemeralKeySecret: key.secret };
}

/**
 * Total monthly capacity across cards that can still be charged.
 *
 * Cancelled cards are excluded — retiring a card should free its allowance,
 * or the envelope would ratchet permanently downward as cards are rotated.
 * Cards issued before the limit was recorded count as zero rather than being
 * guessed at; under-counting an old card is safer than inventing a number,
 * and it self-corrects as cards are reissued.
 */
export function activeCardCapacityMinor(): number {
  const row = db
    .prepare(
      // Both spellings: Stripe reports 'canceled', while cancelStripeCard
      // writes 'inactive'. Excluding only one would leave retired cards
      // consuming the envelope forever.
      `SELECT COALESCE(SUM(monthly_limit_minor), 0) AS total FROM stripe_cards
       WHERE status NOT IN ('canceled', 'inactive')`
    )
    .get() as unknown as { total: number };
  return row.total;
}
