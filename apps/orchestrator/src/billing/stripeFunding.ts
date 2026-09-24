import Stripe from "stripe";
import { createHash, randomUUID } from "node:crypto";
import { checkCapacity } from "./envelopes.js";
import type { IssuingBalanceLine, MoneyReceiptRecord, StripeCardRecord, StripePaymentLinkRecord } from "@jarvis/shared";
import { db } from "../db/db.js";
import { getConnectionCredentials } from "../db/connectionsRepo.js";
import { addCustomerRevenue, createCustomer, getCustomerByEmail, recordCustomerInboundEvent } from "../db/customerRepo.js";
import { recordLeadRevenue } from "../db/measurementFactsRepo.js";
import { notify } from "../notifications/notifier.js";

/**
 * Jarvis never moves money and never sees a PAN or CVC — it only reads
 * balance, issues/cancels cards, and mints short-lived reveal sessions that
 * Stripe's own Issuing Elements use directly in the browser. Funding the
 * Stripe balance itself (bank transfer, Stripe's crypto onramp, whatever)
 * happens entirely on Stripe's side; nothing here initiates a transfer.
 *
 * Money-in follows the same shape: Jarvis creates Payment Links and records
 * confirmed receipts, but card and customer payment details never reach this
 * server — checkout and payment happen entirely on Stripe's hosted pages.
 */

interface CardRow {
  card_id: string;
  purpose_label: string;
  monthly_limit_minor: number | null;
  brand: string;
  last4: string;
  status: string;
  created_at: string;
}

function mapCard(row: CardRow): StripeCardRecord {
  return {
    cardId: row.card_id,
    purposeLabel: row.purpose_label,
    monthlyLimitMinor: row.monthly_limit_minor,
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

/** Secret key only — payment links and webhooks don't need the cardholder. */
function secretKey(): string {
  const creds = getConnectionCredentials("stripe");
  if (!creds?.secretKey) {
    throw new Error("Stripe is not connected yet — add a restricted API key first.");
  }
  return creds.secretKey;
}

function linkClient(): Stripe {
  return new Stripe(secretKey());
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
  try {
    db.prepare(
      `INSERT INTO stripe_cards (card_id, purpose_label, monthly_limit_minor, brand, last4, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(card.id, input.purposeLabel, input.monthlyLimitMinor, card.brand, card.last4, card.status, now);
  } catch (err) {
    // The card already exists on Stripe — that spend authority is real and
    // active regardless of what happens next. Losing this insert silently
    // would mean Jarvis granted spending power it has no record of.
    notify({
      type: "automation_failed",
      severity: "error",
      title: "Card issued but not recorded locally",
      body: `Stripe issued card ${card.id} (…${card.last4}, $${(input.monthlyLimitMinor / 100).toFixed(2)}/mo, "${input.purposeLabel}") but saving it here failed: ${err instanceof Error ? err.message : String(err)}. It exists on Stripe and will not appear in Jarvis until reconciled by hand.`,
    });
    throw err;
  }
  return { cardId: card.id, purposeLabel: input.purposeLabel, monthlyLimitMinor: input.monthlyLimitMinor, brand: card.brand, last4: card.last4, status: card.status, createdAt: now };
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

interface PaymentLinkRow {
  id: string;
  label: string;
  amount_minor: number;
  currency: string;
  url: string;
  status: string;
  created_at: string;
}

function mapPaymentLink(row: PaymentLinkRow): StripePaymentLinkRecord {
  return {
    id: row.id,
    label: row.label,
    amountMinor: row.amount_minor,
    currency: row.currency,
    url: row.url,
    status: row.status,
    createdAt: row.created_at,
  };
}

interface ReceiptRow {
  id: string;
  customer_id: string | null;
  email: string | null;
  amount_minor: number;
  currency: string;
  created_at: string;
}

function mapReceipt(row: ReceiptRow): MoneyReceiptRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    email: row.email,
    amountMinor: row.amount_minor,
    currency: row.currency,
    createdAt: row.created_at,
  };
}

/**
 * Creates a Stripe Payment Link so someone can pay the operator. The link
 * itself collects nothing — checkout happens on Stripe's hosted page, and
 * only a signed `checkout.session.completed` webhook (see below) records
 * money as received. Creating a link is safe to approve freely: unlike a
 * card or an ad budget, it authorises no spend.
 */
export async function createPaymentLink(input: {
  label: string;
  amountMinor: number;
  currency: "USD" | "GBP";
}): Promise<StripePaymentLinkRecord> {
  const label = input.label.trim();
  if (!label) throw new Error("A payment link needs a label.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("A payment link needs a positive amount in the currency's minor unit (cents, pence).");
  }
  const link = await linkClient().paymentLinks.create({
    line_items: [
      {
        price_data: {
          currency: input.currency.toLowerCase(),
          product_data: { name: label.slice(0, 200) },
          unit_amount: input.amountMinor,
        },
        quantity: 1,
      },
    ],
  });
  if (!link.url) throw new Error("Stripe created the link but returned no URL.");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO money_payment_links (id, label, amount_minor, currency, url, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(link.id, label, input.amountMinor, input.currency, link.url, link.active === false ? "inactive" : "active", now);
  return mapPaymentLink(
    db.prepare(`SELECT * FROM money_payment_links WHERE id = ?`).get(link.id) as unknown as PaymentLinkRow
  );
}

export function listPaymentLinks(): StripePaymentLinkRecord[] {
  const rows = db.prepare(`SELECT * FROM money_payment_links ORDER BY created_at DESC`).all() as unknown as PaymentLinkRow[];
  return rows.map(mapPaymentLink);
}

export function listMoneyReceipts(limit = 100): MoneyReceiptRecord[] {
  const rows = db.prepare(`SELECT * FROM money_receipts ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as ReceiptRow[];
  return rows.map(mapReceipt);
}

/**
 * Verifies a Stripe webhook payload against the endpoint secret. Throws on
 * anything unverifiable — the route answers 401 and records nothing.
 */
export function verifyStripeWebhook(raw: Buffer, signature: string): Stripe.Event {
  const creds = getConnectionCredentials("stripe");
  if (!creds?.webhookSecret) {
    throw new Error("Stripe webhooks are not configured — add the endpoint secret first.");
  }
  return new Stripe(secretKey()).webhooks.constructEvent(raw, signature, creds.webhookSecret);
}

export interface StripeReceipt {
  duplicate: boolean;
  receipt?: MoneyReceiptRecord;
}

/**
 * Records a completed Stripe checkout as money received. Idempotent: Stripe
 * retries webhook deliveries, and each retry carries the same session id, so
 * the second arrival is acknowledged without double-counting revenue.
 *
 * The payer is matched to a customer by email, created if new, and the
 * amount accumulates onto their revenue. The same amount lands in
 * measurement_facts as a 'lead'-source fact and in money_receipts — three
 * views of one event, all written together.
 */
export function recordStripeReceipt(session: Stripe.Checkout.Session): StripeReceipt {
  const sessionId = session.id;
  const amountMinor = session.amount_total ?? 0;
  const currency = (session.currency ?? "usd").toUpperCase();
  if (!sessionId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("That checkout session carries no usable amount.");
  }
  if (!recordCustomerInboundEvent("stripe", sessionId, createHash("sha256").update(JSON.stringify(session)).digest("hex"))) {
    return { duplicate: true };
  }
  const email = session.customer_details?.email?.trim() || null;
  const name = session.customer_details?.name?.trim() || email || "Customer";
  const customer = email ? (getCustomerByEmail(email) ?? createCustomer({ name, email })) : undefined;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO money_receipts (id, customer_id, email, amount_minor, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, customer?.id ?? null, email, amountMinor, currency, now);
  if (customer) addCustomerRevenue(customer.id, amountMinor);
  recordLeadRevenue({ revenueMinor: amountMinor, currency, capturedAt: now });
  return {
    duplicate: false,
    receipt: mapReceipt(
      db.prepare(`SELECT * FROM money_receipts WHERE id = ?`).get(sessionId) as unknown as ReceiptRow
    ),
  };
}
