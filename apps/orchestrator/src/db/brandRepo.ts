import { randomUUID } from "node:crypto";
import type {
  BrandRecord,
  VisualPromptKind,
  VisualPromptRating,
  VisualPromptRecord,
  VisualPromptRunKind,
  VisualPromptRunRecord,
  VisualPromptRunStatus,
  VisualPromptStatus,
} from "@jarvis/shared";
import { db, DEFAULT_AGENT_ID } from "./db.js";

interface BrandRow {
  id: string;
  agent_id: string | null;
  name: string;
  description: string;
  logo_file: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
}

function mapBrand(row: BrandRow): BrandRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description,
    logoFile: row.logo_file,
    website: row.website,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBrand(input: {
  name: string;
  description: string;
  logoFile?: string | null;
  website?: string | null;
  agentId?: string | null;
}): BrandRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO brands (id, agent_id, name, description, logo_file, website, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.agentId ?? DEFAULT_AGENT_ID,
    input.name,
    input.description,
    input.logoFile ?? null,
    input.website ?? null,
    now,
    now
  );
  return getBrand(id, input.agentId ?? DEFAULT_AGENT_ID)!;
}

export function getBrand(id: string, agentId?: string): BrandRecord | undefined {
  const row = agentId
    ? db.prepare(`SELECT * FROM brands WHERE id = ? AND agent_id = ?`).get(id, agentId)
    : db.prepare(`SELECT * FROM brands WHERE id = ?`).get(id);
  return row ? mapBrand(row as unknown as BrandRow) : undefined;
}

export function listBrands(agentId?: string): BrandRecord[] {
  const rows = agentId
    ? db.prepare(`SELECT * FROM brands WHERE agent_id = ? ORDER BY updated_at DESC`).all(agentId)
    : db.prepare(`SELECT * FROM brands ORDER BY updated_at DESC`).all();
  return (rows as unknown as BrandRow[]).map(mapBrand);
}

export function updateBrand(
  id: string,
  patch: Partial<{ name: string; description: string; logoFile: string | null; website: string | null }>
): BrandRecord | undefined {
  const current = getBrand(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE brands SET name = ?, description = ?, logo_file = ?, website = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.name ?? current.name,
    patch.description ?? current.description,
    patch.logoFile !== undefined ? patch.logoFile : current.logoFile,
    patch.website !== undefined ? patch.website : current.website,
    now,
    id
  );
  return getBrand(id);
}

export function deleteBrand(id: string): void {
  db.prepare(`DELETE FROM brands WHERE id = ?`).run(id);
}

interface VisualPromptRow {
  id: string;
  brand_id: string;
  workflow_id: string | null;
  title: string;
  body: string;
  kind: string;
  status: string;
  model: string | null;
  reference_image_ids: string;
  parent_id: string | null;
  rating: string | null;
  result_file: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapVisualPrompt(row: VisualPromptRow): VisualPromptRecord {
  let referenceImageIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.reference_image_ids);
    if (Array.isArray(parsed)) referenceImageIds = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    referenceImageIds = [];
  }
  return {
    id: row.id,
    brandId: row.brand_id,
    workflowId: row.workflow_id,
    title: row.title,
    body: row.body,
    kind: row.kind as VisualPromptKind,
    status: row.status as VisualPromptStatus,
    model: row.model,
    referenceImageIds,
    parentId: row.parent_id,
    rating: row.rating as VisualPromptRating | null,
    resultFile: row.result_file,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getVisualPrompt(id: string, agentId?: string): VisualPromptRecord | undefined {
  const row = agentId
    ? db
        .prepare(
          `SELECT v.* FROM visual_prompts v JOIN brands b ON b.id = v.brand_id WHERE v.id = ? AND b.agent_id = ?`
        )
        .get(id, agentId)
    : db.prepare(`SELECT * FROM visual_prompts WHERE id = ?`).get(id);
  return row ? mapVisualPrompt(row as unknown as VisualPromptRow) : undefined;
}

export function listVisualPrompts(brandId?: string, agentId?: string): VisualPromptRecord[] {
  const rows = agentId
    ? brandId
      ? db
          .prepare(
            `SELECT v.* FROM visual_prompts v JOIN brands b ON b.id = v.brand_id WHERE v.brand_id = ? AND b.agent_id = ? ORDER BY v.updated_at DESC`
          )
          .all(brandId, agentId)
      : db
          .prepare(
            `SELECT v.* FROM visual_prompts v JOIN brands b ON b.id = v.brand_id WHERE b.agent_id = ? ORDER BY v.updated_at DESC`
          )
          .all(agentId)
    : brandId
      ? db.prepare(`SELECT * FROM visual_prompts WHERE brand_id = ? ORDER BY updated_at DESC`).all(brandId)
      : db.prepare(`SELECT * FROM visual_prompts ORDER BY updated_at DESC`).all();
  return (rows as unknown as VisualPromptRow[]).map(mapVisualPrompt);
}

/**
 * Kept prompts, newest first — the self-improvement signal. Each scripts run
 * receives these as exemplars ("this is what good looks like for this
 * brand"), so output converges on the brand's proven style instead of
 * drifting. `needs_work` items are deliberately excluded: the model learns
 * from what to repeat, not from what to avoid, which keeps the signal clean.
 */
export function listKeptPrompts(brandId: string, limit = 8): VisualPromptRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM visual_prompts WHERE brand_id = ? AND rating = 'keep' ORDER BY updated_at DESC LIMIT ?`
    )
    .all(brandId, limit) as unknown as VisualPromptRow[];
  return rows.map(mapVisualPrompt);
}

export function createVisualPrompt(input: {
  brandId: string;
  title: string;
  body: string;
  kind: VisualPromptKind;
  workflowId?: string;
  model?: string | null;
  referenceImageIds?: string[];
  parentId?: string | null;
  sessionId?: string;
}): VisualPromptRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO visual_prompts (id, brand_id, workflow_id, title, body, kind, status, model, reference_image_ids, parent_id, rating, result_file, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, NULL, ?, ?, ?)`
  ).run(
    id,
    input.brandId,
    input.workflowId ?? null,
    input.title,
    input.body,
    input.kind,
    input.model ?? null,
    JSON.stringify(input.referenceImageIds ?? []),
    input.parentId ?? null,
    input.sessionId ?? null,
    now,
    now
  );
  return getVisualPrompt(id)!;
}

export function updateVisualPrompt(
  id: string,
  patch: Partial<{
    title: string;
    body: string;
    kind: VisualPromptKind;
    model: string | null;
    referenceImageIds: string[];
    /** Only human review transitions — generation moves are owned by the runner. */
    status: Extract<VisualPromptStatus, "draft" | "approved" | "rejected">;
    rating: VisualPromptRating | null;
    resultFile: string | null;
  }>
): VisualPromptRecord | undefined {
  const current = getVisualPrompt(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE visual_prompts SET title = ?, body = ?, kind = ?, model = ?, reference_image_ids = ?,
      status = ?, rating = ?, result_file = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.title ?? current.title,
    patch.body ?? current.body,
    patch.kind ?? current.kind,
    patch.model !== undefined ? patch.model : current.model,
    patch.referenceImageIds !== undefined ? JSON.stringify(patch.referenceImageIds) : JSON.stringify(current.referenceImageIds),
    patch.status ?? current.status,
    patch.rating !== undefined ? patch.rating : current.rating,
    patch.resultFile !== undefined ? patch.resultFile : current.resultFile,
    now,
    id
  );
  return getVisualPrompt(id);
}

/**
 * The generation runner's private transition. Approving is human (the HTTP
 * layer); starting and finishing generation is the runner's — a prompt that
 * nobody approved can never reach `generating` through this path, which is
 * what makes "no approval, no spend" structural rather than asked-for.
 */
export function markPromptGenerating(id: string): VisualPromptRecord | undefined {
  const current = getVisualPrompt(id);
  if (!current || current.status !== "approved") return undefined;
  db.prepare(`UPDATE visual_prompts SET status = 'generating', updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id
  );
  return getVisualPrompt(id);
}

export function finishPromptGeneration(
  id: string,
  ok: boolean,
  resultFile?: string | null
): VisualPromptRecord | undefined {
  const current = getVisualPrompt(id);
  if (!current) return undefined;
  db.prepare(
    `UPDATE visual_prompts SET status = ?, result_file = COALESCE(?, result_file), updated_at = ? WHERE id = ?`
  ).run(ok ? "generated" : "approved", resultFile ?? null, new Date().toISOString(), id);
  return getVisualPrompt(id);
}

export function deleteVisualPrompt(id: string): void {
  db.prepare(`DELETE FROM visual_prompts WHERE id = ?`).run(id);
}

interface VisualPromptRunRow {
  id: string;
  kind: string;
  brand_id: string;
  visual_prompt_id: string | null;
  session_id: string;
  status: string;
  requested_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function mapRun(row: VisualPromptRunRow): VisualPromptRunRecord {
  return {
    id: row.id,
    kind: row.kind as VisualPromptRunKind,
    brandId: row.brand_id,
    visualPromptId: row.visual_prompt_id,
    sessionId: row.session_id,
    status: row.status as VisualPromptRunStatus,
    requestedCount: row.requested_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createVisualPromptRun(input: {
  kind: VisualPromptRunKind;
  brandId: string;
  visualPromptId?: string;
  sessionId: string;
  requestedCount: number;
}): VisualPromptRunRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO visual_prompt_runs (id, kind, brand_id, visual_prompt_id, session_id, status, requested_count, error_message, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?, NULL, ?, NULL)`
  ).run(id, input.kind, input.brandId, input.visualPromptId ?? null, input.sessionId, input.requestedCount, now);
  return getVisualPromptRunBySession(input.sessionId)!;
}

export function getVisualPromptRunBySession(sessionId: string): VisualPromptRunRecord | undefined {
  const row = db.prepare(`SELECT * FROM visual_prompt_runs WHERE session_id = ?`).get(sessionId) as
    | unknown
    | undefined;
  return row ? mapRun(row as unknown as VisualPromptRunRow) : undefined;
}

export function listVisualPromptRuns(brandId?: string, agentId?: string): VisualPromptRunRecord[] {
  const rows = agentId
    ? brandId
      ? db
          .prepare(
            `SELECT r.* FROM visual_prompt_runs r JOIN brands b ON b.id = r.brand_id WHERE r.brand_id = ? AND b.agent_id = ? ORDER BY r.created_at DESC`
          )
          .all(brandId, agentId)
      : db
          .prepare(
            `SELECT r.* FROM visual_prompt_runs r JOIN brands b ON b.id = r.brand_id WHERE b.agent_id = ? ORDER BY r.created_at DESC`
          )
          .all(agentId)
    : brandId
      ? db.prepare(`SELECT * FROM visual_prompt_runs WHERE brand_id = ? ORDER BY created_at DESC`).all(brandId)
      : db.prepare(`SELECT * FROM visual_prompt_runs ORDER BY created_at DESC`).all();
  return (rows as unknown as VisualPromptRunRow[]).map(mapRun);
}

export function finishVisualPromptRun(
  sessionId: string,
  status: Exclude<VisualPromptRunStatus, "running">,
  errorMessage?: string
): VisualPromptRunRecord | undefined {
  db.prepare(`UPDATE visual_prompt_runs SET status = ?, error_message = ?, completed_at = ? WHERE session_id = ?`).run(
    status,
    errorMessage ?? null,
    new Date().toISOString(),
    sessionId
  );
  return getVisualPromptRunBySession(sessionId);
}

/** Prevents a restart from leaving a prompt stuck in `generating` forever. */
export function recoverInterruptedVisualPromptRuns(): number {
  const now = new Date().toISOString();
  const runs = db.prepare(
    `UPDATE visual_prompt_runs SET status = 'failed', error_message = 'The service stopped before the run completed.', completed_at = ?
     WHERE status = 'running' AND session_id IN (
       SELECT id FROM sessions WHERE status NOT IN ('starting', 'running', 'waiting_permission')
     )`
  ).run(now);
  db.prepare(`UPDATE visual_prompts SET status = 'approved', updated_at = ? WHERE status = 'generating'`).run(now);
  return Number(runs.changes);
}
