import { randomUUID } from "node:crypto";
import type {
  CreatePaidGrowthCampaignRequest,
  PaidGrowthCampaignRecord,
  PaidGrowthDecisionKind,
  PaidGrowthDecisionRecord,
  PaidGrowthDecisionStatus,
  PaidGrowthStatus,
  UpdatePaidGrowthCampaignRequest,
  UpdatePaidGrowthPerformanceRequest,
} from "@jarvis/shared";
import { db, DEFAULT_AGENT_ID } from "./db.js";

interface CampaignRow {
  id: string;
  agent_id: string | null;
  campaign_id: string | null;
  name: string;
  objective: string;
  platform: string;
  external_campaign_id: string | null;
  external_budget_entity_id: string | null;
  status: string;
  currency: string;
  daily_budget_minor: number;
  lifetime_budget_minor: number;
  approved_budget_minor: number;
  spent_minor: number;
  revenue_minor: number;
  impressions: number;
  clicks: number;
  conversions: number;
  target_roas: number | null;
  start_date: string;
  end_date: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapCampaign(row: CampaignRow): PaidGrowthCampaignRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    campaignId: row.campaign_id,
    name: row.name,
    objective: row.objective,
    platform: row.platform as PaidGrowthCampaignRecord["platform"],
    externalCampaignId: row.external_campaign_id,
    externalBudgetEntityId: row.external_budget_entity_id,
    status: row.status as PaidGrowthStatus,
    currency: row.currency,
    dailyBudgetMinor: row.daily_budget_minor,
    lifetimeBudgetMinor: row.lifetime_budget_minor,
    approvedBudgetMinor: row.approved_budget_minor,
    spentMinor: row.spent_minor,
    revenueMinor: row.revenue_minor,
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    targetRoas: row.target_roas,
    startDate: row.start_date,
    endDate: row.end_date,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPaidGrowthCampaign(input: CreatePaidGrowthCampaignRequest & { agentId?: string | null }): PaidGrowthCampaignRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO paid_growth_campaigns
      (id, agent_id, campaign_id, name, objective, platform, external_campaign_id, external_budget_entity_id, status, currency,
       daily_budget_minor, lifetime_budget_minor, approved_budget_minor, spent_minor,
       revenue_minor, impressions, clicks, conversions, target_roas, start_date, end_date,
       last_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, NULL, ?, ?)`
  ).run(
    id,
    input.agentId ?? DEFAULT_AGENT_ID,
    input.campaignId ?? null,
    input.name,
    input.objective,
    input.platform,
    input.externalCampaignId ?? null,
    input.externalBudgetEntityId ?? null,
    input.currency,
    input.dailyBudgetMinor,
    input.lifetimeBudgetMinor,
    input.targetRoas ?? null,
    input.startDate,
    input.endDate ?? null,
    now,
    now
  );
  return getPaidGrowthCampaign(id)!;
}

export function getPaidGrowthCampaign(id: string, agentId?: string): PaidGrowthCampaignRecord | undefined {
  const row = (agentId ? db.prepare(`SELECT * FROM paid_growth_campaigns WHERE id = ? AND agent_id = ?`).get(id, agentId) : db.prepare(`SELECT * FROM paid_growth_campaigns WHERE id = ?`).get(id)) as unknown as CampaignRow | undefined;
  return row ? mapCampaign(row) : undefined;
}

export function listPaidGrowthCampaigns(agentId?: string): PaidGrowthCampaignRecord[] {
  const order = `ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending_approval' THEN 1 WHEN 'approved' THEN 2 WHEN 'draft' THEN 3 WHEN 'paused' THEN 4 ELSE 5 END, updated_at DESC`;
  const rows = agentId ? db.prepare(`SELECT * FROM paid_growth_campaigns WHERE agent_id = ? ${order}`).all(agentId) : db.prepare(`SELECT * FROM paid_growth_campaigns ${order}`).all();
  return (rows as unknown as CampaignRow[]).map(mapCampaign);
}

export function updatePaidGrowthCampaign(
  id: string,
  patch: Omit<UpdatePaidGrowthCampaignRequest, "status"> & Partial<{ status: PaidGrowthStatus; approvedBudgetMinor: number }>
): PaidGrowthCampaignRecord | undefined {
  const current = getPaidGrowthCampaign(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE paid_growth_campaigns SET name = ?, objective = ?, external_campaign_id = ?, external_budget_entity_id = ?, status = ?,
      daily_budget_minor = ?, lifetime_budget_minor = ?, approved_budget_minor = ?, target_roas = ?,
      start_date = ?, end_date = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.name ?? current.name,
    patch.objective ?? current.objective,
    patch.externalCampaignId !== undefined ? patch.externalCampaignId : current.externalCampaignId,
    patch.externalBudgetEntityId !== undefined ? patch.externalBudgetEntityId : current.externalBudgetEntityId,
    patch.status ?? current.status,
    patch.dailyBudgetMinor ?? current.dailyBudgetMinor,
    patch.lifetimeBudgetMinor ?? current.lifetimeBudgetMinor,
    patch.approvedBudgetMinor ?? current.approvedBudgetMinor,
    patch.targetRoas !== undefined ? patch.targetRoas : current.targetRoas,
    patch.startDate ?? current.startDate,
    patch.endDate !== undefined ? patch.endDate : current.endDate,
    now,
    id
  );
  return getPaidGrowthCampaign(id);
}

export function updatePaidGrowthPerformance(
  id: string,
  input: UpdatePaidGrowthPerformanceRequest,
  markSynced = false
): PaidGrowthCampaignRecord | undefined {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE paid_growth_campaigns SET spent_minor = ?, revenue_minor = ?, impressions = ?, clicks = ?,
      conversions = ?, last_synced_at = CASE WHEN ? = 1 THEN ? ELSE last_synced_at END, updated_at = ? WHERE id = ?`
  ).run(input.spentMinor, input.revenueMinor, input.impressions, input.clicks, input.conversions, markSynced ? 1 : 0, now, now, id);
  return result.changes ? getPaidGrowthCampaign(id) : undefined;
}

interface DecisionRow {
  id: string;
  paid_campaign_id: string;
  kind: string;
  status: string;
  reason: string;
  proposed_daily_budget_minor: number | null;
  source_paid_campaign_id: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function mapDecision(row: DecisionRow): PaidGrowthDecisionRecord {
  return {
    id: row.id,
    paidCampaignId: row.paid_campaign_id,
    kind: row.kind as PaidGrowthDecisionKind,
    status: row.status as PaidGrowthDecisionStatus,
    reason: row.reason,
    proposedDailyBudgetMinor: row.proposed_daily_budget_minor,
    sourcePaidCampaignId: row.source_paid_campaign_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

export function createPaidGrowthDecision(input: {
  paidCampaignId: string;
  kind: PaidGrowthDecisionKind;
  reason: string;
  proposedDailyBudgetMinor?: number | null;
  sourcePaidCampaignId?: string | null;
}): PaidGrowthDecisionRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO paid_growth_decisions
      (id, paid_campaign_id, kind, status, reason, proposed_daily_budget_minor, source_paid_campaign_id, created_at, reviewed_at)
     VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?, NULL)`
  ).run(id, input.paidCampaignId, input.kind, input.reason, input.proposedDailyBudgetMinor ?? null, input.sourcePaidCampaignId ?? null, now);
  return getPaidGrowthDecision(id)!;
}

export function getPaidGrowthDecision(id: string): PaidGrowthDecisionRecord | undefined {
  const row = db.prepare(`SELECT * FROM paid_growth_decisions WHERE id = ?`).get(id) as unknown as DecisionRow | undefined;
  return row ? mapDecision(row) : undefined;
}

export function listPaidGrowthDecisions(agentId?: string): PaidGrowthDecisionRecord[] {
  const rows = agentId
    ? db.prepare(`SELECT d.* FROM paid_growth_decisions d JOIN paid_growth_campaigns c ON c.id = d.paid_campaign_id WHERE c.agent_id = ? ORDER BY d.created_at DESC`).all(agentId)
    : db.prepare(`SELECT * FROM paid_growth_decisions ORDER BY created_at DESC`).all();
  return (rows as unknown as DecisionRow[]).map(mapDecision);
}

export function hasOpenPaidGrowthDecision(paidCampaignId: string, kind: PaidGrowthDecisionKind): boolean {
  return Boolean(db.prepare(
    `SELECT 1 AS found FROM paid_growth_decisions WHERE paid_campaign_id = ? AND kind = ? AND status = 'proposed' LIMIT 1`
  ).get(paidCampaignId, kind));
}

export function reviewPaidGrowthDecision(
  id: string,
  status: Extract<PaidGrowthDecisionStatus, "approved" | "rejected" | "applied">
): PaidGrowthDecisionRecord | undefined {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE paid_growth_decisions SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'proposed'`
  ).run(status, now, id);
  return result.changes ? getPaidGrowthDecision(id) : undefined;
}
