import { randomUUID } from "node:crypto";
import type {
  WorkflowApprovalPolicy,
  WorkflowGenerationRunRecord,
  WorkflowGenerationStatus,
  WorkflowRecord,
  WorkflowStatus,
  ContentFormat,
  ContentItemRecord,
  ContentStatus,
  ContentPublicationRunRecord,
  ContentPublicationStatus,
  MarketingChannel,
} from "@jarvis/shared";
import { db, DEFAULT_AGENT_ID } from "./db.js";

interface CampaignRow {
  id: string;
  agent_id: string | null;
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: string;
  primary_metric: string;
  approval_policy: string;
  status: string;
  onboarding_stage: number;
  autopilot: number;
  autopilot_interval_hours: number;
  mission_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapCampaign(row: CampaignRow): WorkflowRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    objective: row.objective,
    audience: row.audience,
    offer: row.offer,
    channels: JSON.parse(row.channels) as MarketingChannel[],
    primaryMetric: row.primary_metric,
    approvalPolicy: row.approval_policy as WorkflowApprovalPolicy,
    status: row.status as WorkflowStatus,
    onboardingStage: row.onboarding_stage,
    autopilot: row.autopilot === 1,
    autopilotIntervalHours: row.autopilot_interval_hours,
    missionId: row.mission_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function createWorkflow(input: {
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: MarketingChannel[];
  primaryMetric: string;
  approvalPolicy: WorkflowApprovalPolicy;
  missionId?: string;
  agentId?: string | null;
}): WorkflowRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workflows (id, agent_id, name, objective, audience, offer, channels, primary_metric, approval_policy, status, onboarding_stage, mission_id, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, NULL)`
  ).run(id, input.agentId ?? DEFAULT_AGENT_ID, input.name, input.objective, input.audience, input.offer, JSON.stringify(input.channels), input.primaryMetric, input.approvalPolicy, 0, input.missionId ?? null, now, now);
  return getWorkflow(id, input.agentId ?? DEFAULT_AGENT_ID)!;
}

export function getWorkflow(id: string, agentId?: string): WorkflowRecord | undefined {
  const row = agentId
    ? db.prepare(`SELECT * FROM workflows WHERE id = ? AND agent_id = ?`).get(id, agentId)
    : db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id);
  return row ? mapCampaign(row as unknown as CampaignRow) : undefined;
}

export function listWorkflows(agentId?: string): WorkflowRecord[] {
  const order = `ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 WHEN 'paused' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END, updated_at DESC`;
  const rows = agentId
    ? db.prepare(`SELECT * FROM workflows WHERE agent_id = ? ${order}`).all(agentId)
    : db.prepare(`SELECT * FROM workflows ${order}`).all();
  return (rows as unknown as CampaignRow[]).map(mapCampaign);
}

export function updateWorkflow(id: string, patch: Partial<{
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: MarketingChannel[];
  primaryMetric: string;
  approvalPolicy: WorkflowApprovalPolicy;
  status: WorkflowStatus;
  onboardingStage: number;
  autopilot: boolean;
  autopilotIntervalHours: number;
  missionId: string | null;
}>): WorkflowRecord | undefined {
  const current = getWorkflow(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  const status = patch.status ?? current.status;
  const completedAt = status === "completed" && current.status !== "completed"
    ? now
    : status === "completed" ? current.completedAt : null;
  db.prepare(
    `UPDATE workflows SET name = ?, objective = ?, audience = ?, offer = ?, channels = ?, primary_metric = ?, approval_policy = ?, status = ?, onboarding_stage = ?, autopilot = ?, autopilot_interval_hours = ?, mission_id = ?, updated_at = ?, completed_at = ? WHERE id = ?`
  ).run(
    patch.name ?? current.name,
    patch.objective ?? current.objective,
    patch.audience ?? current.audience,
    patch.offer ?? current.offer,
    JSON.stringify(patch.channels ?? current.channels),
    patch.primaryMetric ?? current.primaryMetric,
    patch.approvalPolicy ?? current.approvalPolicy,
    status,
    patch.onboardingStage !== undefined ? patch.onboardingStage : current.onboardingStage,
    (patch.autopilot !== undefined ? patch.autopilot : current.autopilot) ? 1 : 0,
    patch.autopilotIntervalHours !== undefined ? patch.autopilotIntervalHours : current.autopilotIntervalHours,
    patch.missionId !== undefined ? patch.missionId : current.missionId,
    now,
    completedAt,
    id
  );
  return getWorkflow(id);
}

export function deleteWorkflow(id: string): void {
  db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
}

interface ContentItemRow {
  id: string;
  workflow_id: string;
  title: string;
  body: string;
  format: string;
  channel: string;
  status: string;
  scheduled_for: string | null;
  published_at: string | null;
  performance_summary: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapContentItem(row: ContentItemRow): ContentItemRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    title: row.title,
    body: row.body,
    format: row.format as ContentFormat,
    channel: row.channel as MarketingChannel,
    status: row.status as ContentStatus,
    scheduledFor: row.scheduled_for,
    publishedAt: row.published_at,
    performanceSummary: row.performance_summary,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getContentItem(id: string, agentId?: string): ContentItemRecord | undefined {
  const row = agentId
    ? db.prepare(`SELECT c.* FROM content_items c JOIN workflows p ON p.id = c.workflow_id WHERE c.id = ? AND p.agent_id = ?`).get(id, agentId)
    : db.prepare(`SELECT * FROM content_items WHERE id = ?`).get(id);
  return row ? mapContentItem(row as unknown as ContentItemRow) : undefined;
}

export function listContentItems(workflowId?: string, agentId?: string): ContentItemRecord[] {
  const rows = agentId
    ? workflowId
      ? db.prepare(`SELECT c.* FROM content_items c JOIN workflows p ON p.id = c.workflow_id WHERE c.workflow_id = ? AND p.agent_id = ? ORDER BY c.updated_at DESC`).all(workflowId, agentId)
      : db.prepare(`SELECT c.* FROM content_items c JOIN workflows p ON p.id = c.workflow_id WHERE p.agent_id = ? ORDER BY c.updated_at DESC`).all(agentId)
    : workflowId
      ? db.prepare(`SELECT * FROM content_items WHERE workflow_id = ? ORDER BY updated_at DESC`).all(workflowId)
      : db.prepare(`SELECT * FROM content_items ORDER BY updated_at DESC`).all();
  return (rows as unknown as ContentItemRow[]).map(mapContentItem);
}

export function createContentItem(input: {
  workflowId: string;
  title: string;
  body: string;
  format: ContentFormat;
  channel: MarketingChannel;
  status?: Extract<ContentStatus, "idea" | "draft">;
  sessionId?: string;
}): ContentItemRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO content_items (id, workflow_id, title, body, format, channel, status, scheduled_for, published_at, performance_summary, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`
  ).run(id, input.workflowId, input.title, input.body, input.format, input.channel, input.status ?? "draft", input.sessionId ?? null, now, now);
  return getContentItem(id)!;
}

export function updateContentItem(id: string, patch: Partial<{
  title: string;
  body: string;
  format: ContentFormat;
  channel: MarketingChannel;
  status: ContentStatus;
  scheduledFor: string | null;
  performanceSummary: string | null;
}>): ContentItemRecord | undefined {
  const current = getContentItem(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  const status = patch.status ?? current.status;
  const publishedAt = ["published", "measured"].includes(status)
    ? current.publishedAt ?? now
    : null;
  db.prepare(
    `UPDATE content_items SET title = ?, body = ?, format = ?, channel = ?, status = ?, scheduled_for = ?, published_at = ?, performance_summary = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.title ?? current.title,
    patch.body ?? current.body,
    patch.format ?? current.format,
    patch.channel ?? current.channel,
    status,
    patch.scheduledFor !== undefined ? patch.scheduledFor : current.scheduledFor,
    publishedAt,
    patch.performanceSummary !== undefined ? patch.performanceSummary : current.performanceSummary,
    now,
    id
  );
  return getContentItem(id);
}

export function deleteContentItem(id: string): void {
  db.prepare(`DELETE FROM content_items WHERE id = ?`).run(id);
}

interface GenerationRunRow {
  id: string;
  workflow_id: string;
  session_id: string;
  status: string;
  requested_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function mapGenerationRun(row: GenerationRunRow): WorkflowGenerationRunRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    sessionId: row.session_id,
    status: row.status as WorkflowGenerationStatus,
    requestedCount: row.requested_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createWorkflowGenerationRun(input: { workflowId: string; sessionId: string; requestedCount: number }): WorkflowGenerationRunRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workflow_generation_runs (id, workflow_id, session_id, status, requested_count, error_message, created_at, completed_at)
     VALUES (?, ?, ?, 'running', ?, NULL, ?, NULL)`
  ).run(id, input.workflowId, input.sessionId, input.requestedCount, now);
  return getWorkflowGenerationRunBySession(input.sessionId)!;
}

export function getWorkflowGenerationRunBySession(sessionId: string): WorkflowGenerationRunRecord | undefined {
  const row = db.prepare(`SELECT * FROM workflow_generation_runs WHERE session_id = ?`).get(sessionId) as unknown as GenerationRunRow | undefined;
  return row ? mapGenerationRun(row) : undefined;
}

export function listWorkflowGenerationRuns(workflowId?: string, agentId?: string): WorkflowGenerationRunRecord[] {
  const rows = agentId
    ? workflowId
      ? db.prepare(`SELECT r.* FROM workflow_generation_runs r JOIN workflows c ON c.id = r.workflow_id WHERE r.workflow_id = ? AND c.agent_id = ? ORDER BY r.created_at DESC`).all(workflowId, agentId)
      : db.prepare(`SELECT r.* FROM workflow_generation_runs r JOIN workflows c ON c.id = r.workflow_id WHERE c.agent_id = ? ORDER BY r.created_at DESC`).all(agentId)
    : workflowId
      ? db.prepare(`SELECT * FROM workflow_generation_runs WHERE workflow_id = ? ORDER BY created_at DESC`).all(workflowId)
      : db.prepare(`SELECT * FROM workflow_generation_runs ORDER BY created_at DESC`).all();
  return (rows as unknown as GenerationRunRow[]).map(mapGenerationRun);
}

export function finishWorkflowGenerationRun(sessionId: string, status: Exclude<WorkflowGenerationStatus, "running">, errorMessage?: string): WorkflowGenerationRunRecord | undefined {
  db.prepare(
    `UPDATE workflow_generation_runs SET status = ?, error_message = ?, completed_at = ? WHERE session_id = ?`
  ).run(status, errorMessage ?? null, new Date().toISOString(), sessionId);
  return getWorkflowGenerationRunBySession(sessionId);
}

interface PublicationRunRow {
  external_post_id: string | null;
  id: string;
  content_item_id: string;
  session_id: string;
  platform_id: string;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function mapPublicationRun(row: PublicationRunRow): ContentPublicationRunRecord {
  return {
    id: row.id,
    contentItemId: row.content_item_id,
    sessionId: row.session_id,
    platformId: row.platform_id,
    externalPostId: row.external_post_id,
    status: row.status as ContentPublicationStatus,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createContentPublicationRun(input: { contentItemId: string; sessionId: string; platformId: string }): ContentPublicationRunRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO content_publication_runs (id, content_item_id, session_id, platform_id, status, error_message, created_at, completed_at)
     VALUES (?, ?, ?, ?, 'running', NULL, ?, NULL)`
  ).run(id, input.contentItemId, input.sessionId, input.platformId, now);
  return getContentPublicationRunBySession(input.sessionId)!;
}

export function getContentPublicationRunBySession(sessionId: string): ContentPublicationRunRecord | undefined {
  const row = db.prepare(`SELECT * FROM content_publication_runs WHERE session_id = ?`).get(sessionId) as unknown as PublicationRunRow | undefined;
  return row ? mapPublicationRun(row) : undefined;
}

export function listContentPublicationRuns(workflowId?: string, agentId?: string): ContentPublicationRunRecord[] {
  const rows = agentId
    ? db.prepare(
        `SELECT r.* FROM content_publication_runs r JOIN content_items c ON c.id = r.content_item_id JOIN workflows p ON p.id = c.workflow_id
         WHERE p.agent_id = ? ${workflowId ? "AND c.workflow_id = ?" : ""} ORDER BY r.created_at DESC`
      ).all(...(workflowId ? [agentId, workflowId] : [agentId]))
    : workflowId
    ? db.prepare(
        `SELECT r.* FROM content_publication_runs r JOIN content_items c ON c.id = r.content_item_id
         WHERE c.workflow_id = ? ORDER BY r.created_at DESC`
      ).all(workflowId)
    : db.prepare(`SELECT * FROM content_publication_runs ORDER BY created_at DESC`).all();
  return (rows as unknown as PublicationRunRow[]).map(mapPublicationRun);
}

export function latestContentPublicationRun(contentItemId: string): ContentPublicationRunRecord | undefined {
  const row = db.prepare(
    `SELECT * FROM content_publication_runs WHERE content_item_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(contentItemId) as unknown as PublicationRunRow | undefined;
  return row ? mapPublicationRun(row) : undefined;
}

export function finishContentPublicationRun(sessionId: string, status: Exclude<ContentPublicationStatus, "running">, errorMessage?: string, externalPostId?: string | null): ContentPublicationRunRecord | undefined {
  db.prepare(
    `UPDATE content_publication_runs SET status = ?, error_message = ?, completed_at = ?, external_post_id = ? WHERE session_id = ?`
  ).run(status, errorMessage ?? null, new Date().toISOString(), externalPostId ?? null, sessionId);
  return getContentPublicationRunBySession(sessionId);
}

/**
 * Scheduled content that is genuinely due to publish.
 *
 * Joined to the workflow and restricted to `active` on purpose. Without that
 * join, pausing a workflow did nothing to its already-scheduled content — it
 * kept publishing publicly, which is the opposite of what pausing is for.
 * Completed and archived workflows were equally live. A paused workflow is a
 * statement that something is wrong; the scheduler has to hear it.
 */
export function listDueContentItems(nowIso: string): ContentItemRecord[] {
  return (db.prepare(
    `SELECT c.* FROM content_items c
     JOIN workflows w ON w.id = c.workflow_id
     WHERE w.status = 'active'
       AND c.status = 'scheduled' AND c.scheduled_for IS NOT NULL AND c.scheduled_for <= ?
       AND NOT EXISTS (SELECT 1 FROM content_publication_runs r WHERE r.content_item_id = c.id)
     ORDER BY c.scheduled_for ASC`
  ).all(nowIso) as unknown as ContentItemRow[]).map(mapContentItem);
}

/** Prevents a service restart from leaving a campaign run permanently "running". */
export function recoverInterruptedWorkflowRuns(): number {
  const now = new Date().toISOString();
  const generation = db.prepare(
    `UPDATE workflow_generation_runs SET status = 'failed', error_message = 'The service stopped before generation completed.', completed_at = ?
     WHERE status = 'running' AND session_id IN (
       SELECT id FROM sessions WHERE status NOT IN ('starting', 'running', 'waiting_permission')
     )`
  ).run(now);
  const publication = db.prepare(
    `UPDATE content_publication_runs SET status = 'failed', error_message = 'The service stopped before publication was confirmed.', completed_at = ?
     WHERE status = 'running' AND session_id IN (
       SELECT id FROM sessions WHERE status NOT IN ('starting', 'running', 'waiting_permission')
     )`
  ).run(now);
  return Number(generation.changes) + Number(publication.changes);
}
