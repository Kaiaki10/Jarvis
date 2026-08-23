import type { WorkflowAccountRecord } from "@jarvis/shared";
import { db } from "./db.js";

/**
 * The accounts a workflow may act as (stage 1).
 *
 * A workflow legitimately has several — an X account and an email sender — so
 * this is a join table rather than a column. Publication reads it to decide the
 * one account content may reach, and hands the session only that.
 */
export function workflowAccountIds(workflowId: string): string[] {
  const rows = db
    .prepare(`SELECT connection_id FROM workflow_accounts WHERE workflow_id = ? ORDER BY created_at ASC`)
    .all(workflowId) as unknown as Array<{ connection_id: string }>;
  return rows.map((row) => row.connection_id);
}

export function attachWorkflowAccount(workflowId: string, connectionId: string): void {
  db.prepare(
    `INSERT INTO workflow_accounts (workflow_id, connection_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(workflow_id, connection_id) DO NOTHING`
  ).run(workflowId, connectionId, new Date().toISOString());
}

export function detachWorkflowAccount(workflowId: string, connectionId: string): void {
  db.prepare(
    `DELETE FROM workflow_accounts WHERE workflow_id = ? AND connection_id = ?`
  ).run(workflowId, connectionId);
}

/** Every stage-1 link, for the overview. Agent scoping comes from the workflow. */
export function listWorkflowAccounts(agentId?: string): WorkflowAccountRecord[] {
  const rows = (
    agentId
      ? db
          .prepare(
            `SELECT a.* FROM workflow_accounts a
             JOIN workflows w ON w.id = a.workflow_id
             WHERE w.agent_id = ?`
          )
          .all(agentId)
      : db.prepare(`SELECT * FROM workflow_accounts`).all()
  ) as unknown as Array<{ workflow_id: string; connection_id: string; created_at: string }>;
  return rows.map((row) => ({
    workflowId: row.workflow_id,
    connectionId: row.connection_id,
    createdAt: row.created_at,
  }));
}

/** Observation counts keyed by workflow, for stage 3. */
export function metricCountsByWorkflow(agentId?: string): Record<string, number> {
  const rows = (
    agentId
      ? db
          .prepare(
            `SELECT c.workflow_id AS id, COUNT(*) AS n FROM social_metrics m
             JOIN content_items c ON c.id = m.content_item_id
             JOIN workflows w ON w.id = c.workflow_id
             WHERE w.agent_id = ? GROUP BY c.workflow_id`
          )
          .all(agentId)
      : db
          .prepare(
            `SELECT c.workflow_id AS id, COUNT(*) AS n FROM social_metrics m
             JOIN content_items c ON c.id = m.content_item_id GROUP BY c.workflow_id`
          )
          .all()
  ) as unknown as Array<{ id: string; n: number }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.n]));
}

/** Insight counts keyed by workflow, for stage 5. */
export function insightCountsByWorkflow(agentId?: string): Record<string, number> {
  const rows = (
    agentId
      ? db
          .prepare(
            `SELECT i.workflow_id AS id, COUNT(*) AS n FROM workflow_insights i
             JOIN workflows w ON w.id = i.workflow_id
             WHERE w.agent_id = ? GROUP BY i.workflow_id`
          )
          .all(agentId)
      : db.prepare(`SELECT workflow_id AS id, COUNT(*) AS n FROM workflow_insights GROUP BY workflow_id`).all()
  ) as unknown as Array<{ id: string; n: number }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.n]));
}

/**
 * Ad campaigns linked to each workflow (stage 4).
 *
 * Counts every linked campaign rather than only active ones: the stage asks
 * whether advertising is connected to this workflow at all, which a paused
 * campaign still answers yes to. Spend is bounded separately by the ad budget
 * envelope, so nothing here needs to double as a limit.
 */
export function adCampaignCountsByWorkflow(agentId?: string): Record<string, number> {
  const rows = (
    agentId
      ? db
          .prepare(
            `SELECT p.workflow_id AS id, COUNT(*) AS n FROM paid_growth_campaigns p
             JOIN workflows w ON w.id = p.workflow_id
             WHERE p.workflow_id IS NOT NULL AND w.agent_id = ?
             GROUP BY p.workflow_id`
          )
          .all(agentId)
      : db
          .prepare(
            `SELECT workflow_id AS id, COUNT(*) AS n FROM paid_growth_campaigns
             WHERE workflow_id IS NOT NULL GROUP BY workflow_id`
          )
          .all()
  ) as unknown as Array<{ id: string; n: number }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.n]));
}
