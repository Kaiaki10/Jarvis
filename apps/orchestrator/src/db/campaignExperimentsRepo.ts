import { randomUUID } from "node:crypto";
import type { CampaignExperimentRecord, CampaignExperimentStatus } from "@jarvis/shared";
import { db } from "./db.js";

interface ExperimentRow {
  id: string;
  name: string;
  hypothesis: string;
  status: string;
  min_conversions_per_variant: number;
  min_days_running: number;
  started_at: string;
  concluded_at: string | null;
  winner_paid_campaign_id: string | null;
  conclusion_note: string | null;
  created_at: string;
  updated_at: string;
}

function mapExperiment(row: ExperimentRow): CampaignExperimentRecord {
  return {
    id: row.id,
    name: row.name,
    hypothesis: row.hypothesis,
    status: row.status as CampaignExperimentStatus,
    minConversionsPerVariant: row.min_conversions_per_variant,
    minDaysRunning: row.min_days_running,
    startedAt: row.started_at,
    concludedAt: row.concluded_at,
    winnerPaidCampaignId: row.winner_paid_campaign_id,
    conclusionNote: row.conclusion_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCampaignExperiment(input: {
  name: string;
  hypothesis: string;
  variantPaidCampaignIds: string[];
  controlPaidCampaignId?: string | null;
  minConversionsPerVariant?: number;
  minDaysRunning?: number;
}): CampaignExperimentRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO campaign_experiments
        (id, name, hypothesis, status, min_conversions_per_variant, min_days_running, started_at, concluded_at, winner_paid_campaign_id, conclusion_note, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, NULL, NULL, NULL, ?, ?)`
    ).run(id, input.name, input.hypothesis, input.minConversionsPerVariant ?? 5, input.minDaysRunning ?? 7, now, now, now);
    const insertVariant = db.prepare(
      `INSERT INTO campaign_experiment_variants (experiment_id, paid_campaign_id, is_control) VALUES (?, ?, ?)`
    );
    for (const campaignId of input.variantPaidCampaignIds) {
      insertVariant.run(id, campaignId, campaignId === input.controlPaidCampaignId ? 1 : 0);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getCampaignExperiment(id)!;
}

export function getCampaignExperiment(id: string, agentId?: string): CampaignExperimentRecord | undefined {
  const row = agentId
    ? db.prepare(
        `SELECT DISTINCT e.* FROM campaign_experiments e
         JOIN campaign_experiment_variants v ON v.experiment_id = e.id
         JOIN paid_growth_campaigns c ON c.id = v.paid_campaign_id
         WHERE e.id = ? AND c.agent_id = ?`
      ).get(id, agentId)
    : db.prepare(`SELECT * FROM campaign_experiments WHERE id = ?`).get(id);
  return row ? mapExperiment(row as unknown as ExperimentRow) : undefined;
}

export function listCampaignExperiments(agentId?: string): CampaignExperimentRecord[] {
  const rows = agentId
    ? db.prepare(
        `SELECT DISTINCT e.* FROM campaign_experiments e
         JOIN campaign_experiment_variants v ON v.experiment_id = e.id
         JOIN paid_growth_campaigns c ON c.id = v.paid_campaign_id
         WHERE c.agent_id = ?
         ORDER BY e.started_at DESC`
      ).all(agentId)
    : db.prepare(`SELECT * FROM campaign_experiments ORDER BY started_at DESC`).all();
  return (rows as unknown as ExperimentRow[]).map(mapExperiment);
}

/** Campaign ids belonging to one experiment. The service layer resolves these to full records via paidGrowthRepo, so campaign mapping stays in one place. */
export function listExperimentVariantCampaignIds(experimentId: string): string[] {
  const rows = db
    .prepare(`SELECT paid_campaign_id FROM campaign_experiment_variants WHERE experiment_id = ?`)
    .all(experimentId) as unknown as Array<{ paid_campaign_id: string }>;
  return rows.map((row) => row.paid_campaign_id);
}

export function concludeCampaignExperiment(id: string, patch: {
  status: Extract<CampaignExperimentStatus, "concluded" | "abandoned">;
  winnerPaidCampaignId?: string | null;
  conclusionNote: string;
}): CampaignExperimentRecord | undefined {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE campaign_experiments SET status = ?, concluded_at = ?, winner_paid_campaign_id = ?, conclusion_note = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(patch.status, now, patch.winnerPaidCampaignId ?? null, patch.conclusionNote, now, id);
  return result.changes ? getCampaignExperiment(id) : undefined;
}

export function hasRunningExperimentForCampaign(paidCampaignId: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 AS found FROM campaign_experiment_variants v
         JOIN campaign_experiments e ON e.id = v.experiment_id
         WHERE v.paid_campaign_id = ? AND e.status = 'running' LIMIT 1`
      )
      .get(paidCampaignId)
  );
}
