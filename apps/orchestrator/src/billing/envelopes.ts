import { randomUUID } from "node:crypto";
import type { SpendEnvelopeRecord, SpendLedgerEntry, SpendRail, SpendPeriod } from "@jarvis/shared";
import { db } from "../db/db.js";

interface EnvelopeRow {
  id: string;
  agent_id: string | null;
  rail: string;
  period: string;
  limit_minor: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

function mapEnvelope(row: EnvelopeRow): SpendEnvelopeRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    rail: row.rail as SpendRail,
    period: row.period as SpendPeriod,
    limitMinor: row.limit_minor,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Start of the current day or month, as an ISO string. */
function periodStart(period: SpendPeriod, now: Date): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === "month") d.setDate(1);
  return d.toISOString();
}

export function listEnvelopes(agentId?: string | null): SpendEnvelopeRecord[] {
  const rows = (
    agentId
      ? db
          .prepare(`SELECT * FROM spend_envelopes WHERE agent_id = ? OR agent_id IS NULL ORDER BY rail, period`)
          .all(agentId)
      : db.prepare(`SELECT * FROM spend_envelopes ORDER BY rail, period`).all()
  ) as unknown as EnvelopeRow[];
  return rows.map(mapEnvelope);
}

export function setEnvelope(input: {
  rail: SpendRail;
  period: SpendPeriod;
  limitMinor: number;
  currency: string;
  agentId?: string | null;
}): SpendEnvelopeRecord {
  const now = new Date().toISOString();
  const currency = input.currency.toUpperCase();
  const existing = db
    .prepare(
      `SELECT * FROM spend_envelopes
       WHERE rail = ? AND period = ? AND currency = ? AND IFNULL(agent_id, '') = IFNULL(?, '')`
    )
    .get(input.rail, input.period, currency, input.agentId ?? null) as unknown as
    | EnvelopeRow
    | undefined;

  if (existing) {
    db.prepare(`UPDATE spend_envelopes SET limit_minor = ?, updated_at = ? WHERE id = ?`)
      .run(input.limitMinor, now, existing.id);
    return mapEnvelope({ ...existing, limit_minor: input.limitMinor, updated_at: now });
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO spend_envelopes (id, agent_id, rail, period, limit_minor, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.agentId ?? null, input.rail, input.period, input.limitMinor, currency, now, now);
  return listEnvelopes().find((e) => e.id === id)!;
}

export function removeEnvelope(id: string): void {
  db.prepare(`DELETE FROM spend_envelopes WHERE id = ?`).run(id);
}

/** What has been spent on a rail in the current period, in that currency. */
export function spentInPeriod(
  rail: SpendRail,
  period: SpendPeriod,
  currency: string,
  agentId?: string | null,
  now = new Date()
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM spend_ledger
       WHERE rail = ? AND currency = ? AND created_at >= ?
         AND (? IS NULL OR agent_id = ?)`
    )
    .get(rail, currency.toUpperCase(), periodStart(period, now), agentId ?? null, agentId ?? null) as unknown as {
      total: number;
    };
  return row.total;
}

export interface EnvelopeCheck {
  allowed: boolean;
  reason?: string;
  /** The envelope that blocked it, when one did. */
  envelope?: SpendEnvelopeRecord;
}

/**
 * Whether a spend fits inside every envelope that applies to it.
 *
 * Checked before the money moves, so a blocked spend costs nothing — the same
 * discipline the action cap already uses. Every applicable envelope must pass:
 * a daily allowance does not license exceeding the monthly one.
 *
 * A currency mismatch is refused rather than converted. USDC minor units and
 * USD cents are different scales, and quietly comparing them would authorise
 * roughly a hundred times the intended amount.
 */
export function checkEnvelopes(input: {
  rail: SpendRail;
  amountMinor: number;
  currency: string;
  agentId?: string | null;
  now?: Date;
}): EnvelopeCheck {
  const now = input.now ?? new Date();
  const currency = input.currency.toUpperCase();

  if (input.amountMinor < 0) {
    return { allowed: false, reason: "A spend cannot be negative." };
  }

  const applicable = listEnvelopes(input.agentId).filter(
    (envelope) => envelope.rail === input.rail
  );
  if (applicable.length === 0) {
    return {
      allowed: false,
      reason:
        `No spending limit is set for the ${input.rail} rail, so Jarvis will not spend on it. ` +
        `Set one before enabling anything that costs money.`,
    };
  }

  const wrongCurrency = applicable.filter((e) => e.currency !== currency);
  const matching = applicable.filter((e) => e.currency === currency);
  if (matching.length === 0) {
    return {
      allowed: false,
      reason:
        `The ${input.rail} limit is set in ${wrongCurrency[0]?.currency} but this spend is in ` +
        `${currency}. Jarvis does not convert between currencies — set a ${currency} limit.`,
    };
  }

  for (const envelope of matching) {
    const spent = spentInPeriod(envelope.rail, envelope.period, currency, envelope.agentId, now);
    if (spent + input.amountMinor > envelope.limitMinor) {
      return {
        allowed: false,
        envelope,
        reason:
          `This would exceed the ${envelope.period}ly ${envelope.rail} limit: ` +
          `${spent + input.amountMinor} of ${envelope.limitMinor} ${currency} minor units.`,
      };
    }
  }

  return { allowed: true };
}

/** Records a spend that actually happened. Never called for a blocked attempt. */
export function recordSpend(input: {
  rail: SpendRail;
  amountMinor: number;
  currency: string;
  reason: string;
  agentId?: string | null;
  sessionId?: string | null;
  externalRef?: string | null;
}): SpendLedgerEntry {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO spend_ledger (id, agent_id, rail, amount_minor, currency, reason, session_id, external_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.agentId ?? null,
    input.rail,
    input.amountMinor,
    input.currency.toUpperCase(),
    input.reason,
    input.sessionId ?? null,
    input.externalRef ?? null,
    now
  );
  return {
    id,
    agentId: input.agentId ?? null,
    rail: input.rail,
    amountMinor: input.amountMinor,
    currency: input.currency.toUpperCase(),
    reason: input.reason,
    sessionId: input.sessionId ?? null,
    externalRef: input.externalRef ?? null,
    createdAt: now,
  };
}

export function listSpendLedger(limit = 100, agentId?: string | null): SpendLedgerEntry[] {
  const rows = (
    agentId
      ? db
          .prepare(`SELECT * FROM spend_ledger WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(agentId, limit)
      : db.prepare(`SELECT * FROM spend_ledger ORDER BY created_at DESC LIMIT ?`).all(limit)
  ) as unknown as Array<{
    id: string;
    agent_id: string | null;
    rail: string;
    amount_minor: number;
    currency: string;
    reason: string;
    session_id: string | null;
    external_ref: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    rail: row.rail as SpendRail,
    amountMinor: row.amount_minor,
    currency: row.currency,
    reason: row.reason,
    sessionId: row.session_id,
    externalRef: row.external_ref,
    createdAt: row.created_at,
  }));
}
