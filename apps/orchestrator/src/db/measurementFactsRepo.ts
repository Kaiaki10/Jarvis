import { randomUUID } from "node:crypto";
import type { MeasurementFactMetric, MeasurementFactRecord, MeasurementFactSource } from "@jarvis/shared";
import { db } from "./db.js";

interface FactRow {
  id: string;
  source: string;
  paid_campaign_id: string | null;
  workflow_id: string | null;
  metric: string;
  value: number;
  currency: string | null;
  captured_at: string;
}

function mapFact(row: FactRow): MeasurementFactRecord {
  return {
    id: row.id,
    source: row.source as MeasurementFactSource,
    paidCampaignId: row.paid_campaign_id,
    workflowId: row.workflow_id,
    metric: row.metric as MeasurementFactMetric,
    value: row.value,
    currency: row.currency,
    capturedAt: row.captured_at,
  };
}

/**
 * Writes one row per metric for a single observation -- append-only, mirroring
 * social_metrics's "one row per observation" design (schema.sql). Called as a
 * side effect of Paid Growth's existing 15-minute sync, never from a separate
 * poller.
 */
export function recordMeasurementFacts(input: {
  paidCampaignId: string;
  workflowId: string | null;
  currency: string;
  capturedAt: string;
  spentMinor: number;
  revenueMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
}): void {
  const rows: Array<{ metric: MeasurementFactMetric; value: number; currency: string | null }> = [
    { metric: "spent_minor", value: input.spentMinor, currency: input.currency },
    { metric: "revenue_minor", value: input.revenueMinor, currency: input.currency },
    { metric: "impressions", value: input.impressions, currency: null },
    { metric: "clicks", value: input.clicks, currency: null },
    { metric: "conversions", value: input.conversions, currency: null },
  ];
  const insert = db.prepare(
    `INSERT INTO measurement_facts (id, source, paid_campaign_id, workflow_id, metric, value, currency, captured_at)
     VALUES (?, 'paid_ads', ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      insert.run(randomUUID(), input.paidCampaignId, input.workflowId, row.metric, row.value, row.currency, input.capturedAt);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listMeasurementFacts(paidCampaignId: string, metric?: MeasurementFactMetric): MeasurementFactRecord[] {
  const rows = metric
    ? db.prepare(`SELECT * FROM measurement_facts WHERE paid_campaign_id = ? AND metric = ? ORDER BY captured_at DESC`).all(paidCampaignId, metric)
    : db.prepare(`SELECT * FROM measurement_facts WHERE paid_campaign_id = ? ORDER BY captured_at DESC`).all(paidCampaignId);
  return (rows as unknown as FactRow[]).map(mapFact);
}

/**
 * Records one confirmed money-in receipt (e.g. a completed Stripe
 * checkout) as a 'lead'-source revenue fact. Single row, not the five-row
 * paid-ads observation — a receipt has no spend, impressions, or clicks.
 * Has no paid_campaign_id by construction; callers that join through
 * paid_campaigns (like listMeasurementFactsForAgent) will not see these
 * rows, which is correct — lead revenue is read via the customer it lands
 * on and the /attribution reads, not the ad-campaign history.
 */
export function recordLeadRevenue(input: {
  revenueMinor: number;
  currency: string;
  capturedAt: string;
}): MeasurementFactRecord {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO measurement_facts (id, source, paid_campaign_id, workflow_id, metric, value, currency, captured_at)
     VALUES (?, 'lead', NULL, NULL, 'revenue_minor', ?, ?, ?)`
  ).run(id, input.revenueMinor, input.currency, input.capturedAt);
  const row = db.prepare(`SELECT * FROM measurement_facts WHERE id = ?`).get(id) as unknown as FactRow;
  return mapFact(row);
}

/**
 * Agent-scoped read. `source = 'paid_ads'` joins through paid_campaign_id
 * today; a future 'organic' or 'lead' source will need its own join branch
 * here (via workflow_id or a customer FK), not a schema change.
 */
export function listMeasurementFactsForAgent(agentId: string, since?: string): MeasurementFactRecord[] {
  const rows = since
    ? db.prepare(
        `SELECT f.* FROM measurement_facts f
         JOIN paid_growth_campaigns c ON c.id = f.paid_campaign_id
         WHERE c.agent_id = ? AND f.source = 'paid_ads' AND f.captured_at >= ?
         ORDER BY f.captured_at DESC`
      ).all(agentId, since)
    : db.prepare(
        `SELECT f.* FROM measurement_facts f
         JOIN paid_growth_campaigns c ON c.id = f.paid_campaign_id
         WHERE c.agent_id = ? AND f.source = 'paid_ads'
         ORDER BY f.captured_at DESC`
      ).all(agentId);
  return (rows as unknown as FactRow[]).map(mapFact);
}
