import { randomUUID } from "node:crypto";
import type {
  CampaignApprovalPolicy,
  CampaignGenerationRunRecord,
  CampaignGenerationStatus,
  CampaignRecord,
  CampaignStatus,
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
  mission_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapCampaign(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    objective: row.objective,
    audience: row.audience,
    offer: row.offer,
    channels: JSON.parse(row.channels) as MarketingChannel[],
    primaryMetric: row.primary_metric,
    approvalPolicy: row.approval_policy as CampaignApprovalPolicy,
    status: row.status as CampaignStatus,
    missionId: row.mission_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function createCampaign(input: {
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: MarketingChannel[];
  primaryMetric: string;
  approvalPolicy: CampaignApprovalPolicy;
  missionId?: string;
  agentId?: string | null;
}): CampaignRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO campaigns (id, agent_id, name, objective, audience, offer, channels, primary_metric, approval_policy, status, mission_id, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL)`
  ).run(id, input.agentId ?? DEFAULT_AGENT_ID, input.name, input.objective, input.audience, input.offer, JSON.stringify(input.channels), input.primaryMetric, input.approvalPolicy, input.missionId ?? null, now, now);
  return getCampaign(id, input.agentId ?? DEFAULT_AGENT_ID)!;
}

export function getCampaign(id: string, agentId?: string): CampaignRecord | undefined {
  const row = agentId
    ? db.prepare(`SELECT * FROM campaigns WHERE id = ? AND agent_id = ?`).get(id, agentId)
    : db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(id);
  return row ? mapCampaign(row as unknown as CampaignRow) : undefined;
}

export function listCampaigns(agentId?: string): CampaignRecord[] {
  const order = `ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 WHEN 'paused' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END, updated_at DESC`;
  const rows = agentId
    ? db.prepare(`SELECT * FROM campaigns WHERE agent_id = ? ${order}`).all(agentId)
    : db.prepare(`SELECT * FROM campaigns ${order}`).all();
  return (rows as unknown as CampaignRow[]).map(mapCampaign);
}

export function updateCampaign(id: string, patch: Partial<{
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: MarketingChannel[];
  primaryMetric: string;
  approvalPolicy: CampaignApprovalPolicy;
  status: CampaignStatus;
  missionId: string | null;
}>): CampaignRecord | undefined {
  const current = getCampaign(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  const status = patch.status ?? current.status;
  const completedAt = status === "completed" && current.status !== "completed"
    ? now
    : status === "completed" ? current.completedAt : null;
  db.prepare(
    `UPDATE campaigns SET name = ?, objective = ?, audience = ?, offer = ?, channels = ?, primary_metric = ?, approval_policy = ?, status = ?, mission_id = ?, updated_at = ?, completed_at = ? WHERE id = ?`
  ).run(
    patch.name ?? current.name,
    patch.objective ?? current.objective,
    patch.audience ?? current.audience,
    patch.offer ?? current.offer,
    JSON.stringify(patch.channels ?? current.channels),
    patch.primaryMetric ?? current.primaryMetric,
    patch.approvalPolicy ?? current.approvalPolicy,
    status,
    patch.missionId !== undefined ? patch.missionId : current.missionId,
    now,
    completedAt,
    id
  );
  return getCampaign(id);
}

export function deleteCampaign(id: string): void {
  db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(id);
}

interface ContentItemRow {
  id: string;
  campaign_id: string;
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
    campaignId: row.campaign_id,
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
    ? db.prepare(`SELECT c.* FROM content_items c JOIN campaigns p ON p.id = c.campaign_id WHERE c.id = ? AND p.agent_id = ?`).get(id, agentId)
    : db.prepare(`SELECT * FROM content_items WHERE id = ?`).get(id);
  return row ? mapContentItem(row as unknown as ContentItemRow) : undefined;
}

export function listContentItems(campaignId?: string, agentId?: string): ContentItemRecord[] {
  const rows = agentId
    ? campaignId
      ? db.prepare(`SELECT c.* FROM content_items c JOIN campaigns p ON p.id = c.campaign_id WHERE c.campaign_id = ? AND p.agent_id = ? ORDER BY c.updated_at DESC`).all(campaignId, agentId)
      : db.prepare(`SELECT c.* FROM content_items c JOIN campaigns p ON p.id = c.campaign_id WHERE p.agent_id = ? ORDER BY c.updated_at DESC`).all(agentId)
    : campaignId
      ? db.prepare(`SELECT * FROM content_items WHERE campaign_id = ? ORDER BY updated_at DESC`).all(campaignId)
      : db.prepare(`SELECT * FROM content_items ORDER BY updated_at DESC`).all();
  return (rows as unknown as ContentItemRow[]).map(mapContentItem);
}

export function createContentItem(input: {
  campaignId: string;
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
    `INSERT INTO content_items (id, campaign_id, title, body, format, channel, status, scheduled_for, published_at, performance_summary, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`
  ).run(id, input.campaignId, input.title, input.body, input.format, input.channel, input.status ?? "draft", input.sessionId ?? null, now, now);
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
  campaign_id: string;
  session_id: string;
  status: string;
  requested_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function mapGenerationRun(row: GenerationRunRow): CampaignGenerationRunRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    status: row.status as CampaignGenerationStatus,
    requestedCount: row.requested_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createCampaignGenerationRun(input: { campaignId: string; sessionId: string; requestedCount: number }): CampaignGenerationRunRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO campaign_generation_runs (id, campaign_id, session_id, status, requested_count, error_message, created_at, completed_at)
     VALUES (?, ?, ?, 'running', ?, NULL, ?, NULL)`
  ).run(id, input.campaignId, input.sessionId, input.requestedCount, now);
  return getCampaignGenerationRunBySession(input.sessionId)!;
}

export function getCampaignGenerationRunBySession(sessionId: string): CampaignGenerationRunRecord | undefined {
  const row = db.prepare(`SELECT * FROM campaign_generation_runs WHERE session_id = ?`).get(sessionId) as unknown as GenerationRunRow | undefined;
  return row ? mapGenerationRun(row) : undefined;
}

export function listCampaignGenerationRuns(campaignId?: string, agentId?: string): CampaignGenerationRunRecord[] {
  const rows = agentId
    ? campaignId
      ? db.prepare(`SELECT r.* FROM campaign_generation_runs r JOIN campaigns c ON c.id = r.campaign_id WHERE r.campaign_id = ? AND c.agent_id = ? ORDER BY r.created_at DESC`).all(campaignId, agentId)
      : db.prepare(`SELECT r.* FROM campaign_generation_runs r JOIN campaigns c ON c.id = r.campaign_id WHERE c.agent_id = ? ORDER BY r.created_at DESC`).all(agentId)
    : campaignId
      ? db.prepare(`SELECT * FROM campaign_generation_runs WHERE campaign_id = ? ORDER BY created_at DESC`).all(campaignId)
      : db.prepare(`SELECT * FROM campaign_generation_runs ORDER BY created_at DESC`).all();
  return (rows as unknown as GenerationRunRow[]).map(mapGenerationRun);
}

export function finishCampaignGenerationRun(sessionId: string, status: Exclude<CampaignGenerationStatus, "running">, errorMessage?: string): CampaignGenerationRunRecord | undefined {
  db.prepare(
    `UPDATE campaign_generation_runs SET status = ?, error_message = ?, completed_at = ? WHERE session_id = ?`
  ).run(status, errorMessage ?? null, new Date().toISOString(), sessionId);
  return getCampaignGenerationRunBySession(sessionId);
}

interface PublicationRunRow {
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

export function listContentPublicationRuns(campaignId?: string, agentId?: string): ContentPublicationRunRecord[] {
  const rows = agentId
    ? db.prepare(
        `SELECT r.* FROM content_publication_runs r JOIN content_items c ON c.id = r.content_item_id JOIN campaigns p ON p.id = c.campaign_id
         WHERE p.agent_id = ? ${campaignId ? "AND c.campaign_id = ?" : ""} ORDER BY r.created_at DESC`
      ).all(...(campaignId ? [agentId, campaignId] : [agentId]))
    : campaignId
    ? db.prepare(
        `SELECT r.* FROM content_publication_runs r JOIN content_items c ON c.id = r.content_item_id
         WHERE c.campaign_id = ? ORDER BY r.created_at DESC`
      ).all(campaignId)
    : db.prepare(`SELECT * FROM content_publication_runs ORDER BY created_at DESC`).all();
  return (rows as unknown as PublicationRunRow[]).map(mapPublicationRun);
}

export function latestContentPublicationRun(contentItemId: string): ContentPublicationRunRecord | undefined {
  const row = db.prepare(
    `SELECT * FROM content_publication_runs WHERE content_item_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(contentItemId) as unknown as PublicationRunRow | undefined;
  return row ? mapPublicationRun(row) : undefined;
}

export function finishContentPublicationRun(sessionId: string, status: Exclude<ContentPublicationStatus, "running">, errorMessage?: string): ContentPublicationRunRecord | undefined {
  db.prepare(
    `UPDATE content_publication_runs SET status = ?, error_message = ?, completed_at = ? WHERE session_id = ?`
  ).run(status, errorMessage ?? null, new Date().toISOString(), sessionId);
  return getContentPublicationRunBySession(sessionId);
}

export function listDueContentItems(nowIso: string): ContentItemRecord[] {
  return (db.prepare(
    `SELECT c.* FROM content_items c
     WHERE c.status = 'scheduled' AND c.scheduled_for IS NOT NULL AND c.scheduled_for <= ?
       AND NOT EXISTS (SELECT 1 FROM content_publication_runs r WHERE r.content_item_id = c.id)
     ORDER BY c.scheduled_for ASC`
  ).all(nowIso) as unknown as ContentItemRow[]).map(mapContentItem);
}

/** Prevents a service restart from leaving a campaign run permanently "running". */
export function recoverInterruptedCampaignRuns(): number {
  const now = new Date().toISOString();
  const generation = db.prepare(
    `UPDATE campaign_generation_runs SET status = 'failed', error_message = 'The service stopped before generation completed.', completed_at = ?
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
