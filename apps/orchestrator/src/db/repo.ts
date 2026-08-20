import { randomUUID } from "node:crypto";
import { db, DEFAULT_AGENT_ID } from "./db.js";
import type {
  SessionRecord,
  SessionEventRecord,
  SessionEventType,
  SessionStatus,
  ChatModel,
  ScheduledTaskRecord,
  SettingsRecord,
  TaskRecord,
  TaskStatus,
  MissionRecord,
  MissionStatus,
  DeliverableRecord,
  DeliverableStatus,
  MissionUpdateRecord,
  MissionUpdateStatus,
  EvolutionProposalRecord,
  EvolutionStage,
  EvolutionRisk,
  EvolutionChangeClass,
  EvolutionPolicyRecord,
  EvolutionAutonomy,
} from "@jarvis/shared";

/**
 * Restricts a listing to one agent.
 *
 * Written as a fragment rather than a WHERE clause so callers keep their own
 * ordering and joins. An undefined agent means "every agent" — used by the
 * scheduler and the maintenance jobs, which operate across the whole system.
 */
function agentFilter(agentId: string | undefined): { sql: string; params: string[] } {
  return agentId ? { sql: " WHERE agent_id = ?", params: [agentId] } : { sql: "", params: [] };
}

interface SessionRow {
  id: string;
  agent_id: string | null;
  claude_session_id: string | null;
  codex_thread_id: string | null;
  model: string;
  title: string;
  status: string;
  cwd: string;
  permission_mode: string;
  allowed_tools: string | null;
  task_id: string | null;
  cost_usd: number | null;
  turns: number | null;
  summary: string | null;
  current_activity: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    agentId: row.agent_id ?? null,
    claudeSessionId: row.claude_session_id,
    codexThreadId: row.codex_thread_id,
    model: row.model as ChatModel,
    title: row.title,
    status: row.status as SessionStatus,
    cwd: row.cwd,
    permissionMode: row.permission_mode,
    allowedTools: row.allowed_tools ? JSON.parse(row.allowed_tools) : null,
    taskId: row.task_id,
    costUsd: row.cost_usd,
    turns: row.turns,
    summary: row.summary ?? null,
    currentActivity: row.current_activity ?? null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSession(input: {
  title: string;
  cwd: string;
  permissionMode: string;
  allowedTools?: string[];
  taskId?: string;
  agentId?: string | null;
  model?: ChatModel;
}): SessionRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, agent_id, claude_session_id, codex_thread_id, model, title, status, cwd, permission_mode, allowed_tools, task_id, cost_usd, turns, error_message, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, ?, ?, 'starting', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
  ).run(
    id,
    input.agentId ?? null,
    input.model ?? "claude",
    input.title,
    input.cwd,
    input.permissionMode,
    input.allowedTools ? JSON.stringify(input.allowedTools) : null,
    input.taskId ?? null,
    now,
    now
  );
  return getSession(id)!;
}

export function getSession(id: string): SessionRecord | undefined {
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | unknown
    | undefined;
  return row ? mapSession(row as SessionRow) : undefined;
}

export function listSessions(agentId?: string): SessionRecord[] {
  const filter = agentFilter(agentId);
  const rows = db
    .prepare(`SELECT * FROM sessions${filter.sql} ORDER BY updated_at DESC`)
    .all(...filter.params) as unknown as SessionRow[];
  return rows.map(mapSession);
}

export function updateSession(
  id: string,
  patch: Partial<{
    claudeSessionId: string;
    codexThreadId: string;
    status: SessionStatus;
    costUsd: number;
    turns: number;
    errorMessage: string;
    summary: string;
    /** Pass null to clear it, e.g. once a run has finished. */
    currentActivity: string | null;
  }>
): void {
  const current = getSession(id);
  if (!current) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET claude_session_id = ?, codex_thread_id = ?, status = ?, cost_usd = ?, turns = ?, error_message = ?, summary = ?, current_activity = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.claudeSessionId ?? current.claudeSessionId,
    patch.codexThreadId ?? current.codexThreadId,
    patch.status ?? current.status,
    patch.costUsd ?? current.costUsd,
    patch.turns ?? current.turns,
    patch.errorMessage ?? current.errorMessage,
    patch.summary ?? current.summary,
    patch.currentActivity !== undefined ? patch.currentActivity : current.currentActivity,
    now,
    id
  );
}

export function markInterruptedIfActive(): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET status = 'interrupted', updated_at = ?
     WHERE status IN ('starting', 'running', 'waiting_permission', 'idle')`
  ).run(now);
}

interface SessionEventRow {
  id: number;
  session_id: string;
  seq: number;
  type: string;
  payload: string;
  created_at: string;
}

function mapEvent(row: SessionEventRow): SessionEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    type: row.type as SessionEventType,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  };
}

/** Beyond this a single event is almost certainly bulk tool output, not signal. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Caps a runaway payload while keeping the shape the UI renders. Reading a large
 * file can produce a multi-megabyte event; storing it verbatim bloats the log for
 * no benefit, but silently dropping structure would break the transcript.
 */
export function truncatePayload(type: SessionEventType, serialized: string): string {
  if (serialized.length <= MAX_PAYLOAD_BYTES) return serialized;

  const note = `[truncated by Jarvis — ${(serialized.length / 1024).toFixed(0)} KB of content omitted]`;

  if (type === "user" || type === "assistant") {
    return JSON.stringify({
      type,
      message: { role: type === "user" ? "user" : "assistant", content: note },
      _truncated: true,
      _originalBytes: serialized.length,
    });
  }

  return JSON.stringify({
    type,
    _truncated: true,
    _originalBytes: serialized.length,
    note,
  });
}

export function appendSessionEvent(
  sessionId: string,
  type: SessionEventType,
  payload: unknown
): SessionEventRecord {
  const maxSeqRow = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) as maxSeq FROM session_events WHERE session_id = ?`
    )
    .get(sessionId) as { maxSeq: number };
  const seq = maxSeqRow.maxSeq + 1;
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO session_events (session_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(sessionId, seq, type, truncatePayload(type, JSON.stringify(payload)), now);
  return {
    id: Number(result.lastInsertRowid),
    sessionId,
    seq,
    type,
    // The live listener gets the full payload; only what's persisted is capped.
    payload,
    createdAt: now,
  };
}

export function listSessionEvents(
  sessionId: string,
  sinceSeq = 0
): SessionEventRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC`
    )
    .all(sessionId, sinceSeq) as unknown as SessionEventRow[];
  return rows.map(mapEvent);
}

export function latestSessionEventSeq(sessionId: string): number {
  const row = db.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM session_events WHERE session_id = ?`)
    .get(sessionId) as unknown as { seq: number };
  return Number(row.seq);
}

interface TaskRow {
  id: string;
  agent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  position: number;
  session_id: string | null;
  mission_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    agentId: row.agent_id ?? null,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    position: row.position,
    sessionId: row.session_id,
    missionId: row.mission_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function createTask(input: {
  title: string;
  description?: string;
  missionId?: string;
  agentId?: string | null;
}): TaskRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  // Position is per agent, so one agent's board does not start at whatever
  // number another agent's board happens to have reached.
  const filter = agentFilter(input.agentId ?? undefined);
  const maxPosRow = db
    .prepare(`SELECT COALESCE(MAX(position), 0) as maxPos FROM tasks${filter.sql}`)
    .get(...filter.params) as { maxPos: number };
  db.prepare(
    `INSERT INTO tasks (id, agent_id, title, description, status, position, session_id, mission_id, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, 'todo', ?, NULL, ?, ?, ?, NULL)`
  ).run(id, input.agentId ?? null, input.title, input.description ?? null, maxPosRow.maxPos + 1, input.missionId ?? null, now, now);
  return getTask(id)!;
}

export function getTask(id: string): TaskRecord | undefined {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | unknown
    | undefined;
  return row ? mapTask(row as TaskRow) : undefined;
}

export function listTasks(agentId?: string): TaskRecord[] {
  const filter = agentFilter(agentId);
  const rows = db
    .prepare(`SELECT * FROM tasks${filter.sql} ORDER BY status ASC, position ASC`)
    .all(...filter.params) as unknown as TaskRow[];
  return rows.map(mapTask);
}

export function updateTask(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    status: TaskStatus;
    position: number;
    missionId: string | null;
  }>
): TaskRecord | undefined {
  const current = getTask(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  const completedAt =
    patch.status === "done" && current.status !== "done"
      ? now
      : patch.status && patch.status !== "done"
        ? null
        : current.completedAt;
  db.prepare(
    `UPDATE tasks SET title = ?, description = ?, status = ?, position = ?, mission_id = ?, updated_at = ?, completed_at = ? WHERE id = ?`
  ).run(
    patch.title ?? current.title,
    patch.description !== undefined ? patch.description : current.description,
    patch.status ?? current.status,
    patch.position ?? current.position,
    patch.missionId !== undefined ? patch.missionId : current.missionId,
    now,
    completedAt,
    id
  );
  return getTask(id);
}

interface MissionRow {
  id: string;
  agent_id: string | null;
  title: string;
  outcome: string;
  status: string;
  target_date: string | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapMission(row: MissionRow): MissionRecord {
  return {
    id: row.id,
    agentId: row.agent_id ?? null,
    title: row.title,
    outcome: row.outcome,
    status: row.status as MissionStatus,
    targetDate: row.target_date,
    nextAction: row.next_action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function createMission(input: { title: string; outcome: string; targetDate?: string; agentId?: string | null }): MissionRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO missions (id, agent_id, title, outcome, status, target_date, next_action, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, 'planned', ?, NULL, ?, ?, NULL)`
  ).run(id, input.agentId ?? null, input.title, input.outcome, input.targetDate ?? null, now, now);
  return getMission(id)!;
}

export function getMission(id: string): MissionRecord | undefined {
  const row = db.prepare(`SELECT * FROM missions WHERE id = ?`).get(id) as unknown as MissionRow | undefined;
  return row ? mapMission(row) : undefined;
}

export function listMissions(agentId?: string): MissionRecord[] {
  const filter = agentFilter(agentId);
  return (db.prepare(
    `SELECT * FROM missions${filter.sql} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 WHEN 'planned' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END, updated_at DESC`
  ).all(...filter.params) as unknown as MissionRow[]).map(mapMission);
}

export function updateMission(id: string, patch: Partial<{
  title: string;
  outcome: string;
  status: MissionStatus;
  targetDate: string | null;
  nextAction: string | null;
}>): MissionRecord | undefined {
  const current = getMission(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  const status = patch.status ?? current.status;
  const completedAt = status === "completed" && current.status !== "completed"
    ? now
    : status !== "completed" ? null : current.completedAt;
  db.prepare(
    `UPDATE missions SET title = ?, outcome = ?, status = ?, target_date = ?, next_action = ?, updated_at = ?, completed_at = ? WHERE id = ?`
  ).run(
    patch.title ?? current.title,
    patch.outcome ?? current.outcome,
    status,
    patch.targetDate !== undefined ? patch.targetDate : current.targetDate,
    patch.nextAction !== undefined ? patch.nextAction : current.nextAction,
    now,
    completedAt,
    id
  );
  return getMission(id);
}

export function deleteMission(id: string): void {
  db.prepare(`DELETE FROM missions WHERE id = ?`).run(id);
}

interface DeliverableRow {
  id: string;
  mission_id: string;
  title: string;
  description: string | null;
  uri: string | null;
  status: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapDeliverable(row: DeliverableRow): DeliverableRecord {
  return {
    id: row.id,
    missionId: row.mission_id,
    title: row.title,
    description: row.description,
    uri: row.uri,
    status: row.status as DeliverableStatus,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDeliverables(missionId?: string, agentId?: string): DeliverableRecord[] {
  const rows = agentId
    ? missionId
      ? db.prepare(`SELECT d.* FROM deliverables d JOIN missions m ON m.id = d.mission_id WHERE d.mission_id = ? AND m.agent_id = ? ORDER BY d.updated_at DESC`).all(missionId, agentId)
      : db.prepare(`SELECT d.* FROM deliverables d JOIN missions m ON m.id = d.mission_id WHERE m.agent_id = ? ORDER BY d.updated_at DESC`).all(agentId)
    : missionId
      ? db.prepare(`SELECT * FROM deliverables WHERE mission_id = ? ORDER BY updated_at DESC`).all(missionId)
      : db.prepare(`SELECT * FROM deliverables ORDER BY updated_at DESC`).all();
  return (rows as unknown as DeliverableRow[]).map(mapDeliverable);
}

export function createDeliverable(input: {
  missionId: string;
  title: string;
  description?: string;
  uri?: string;
  sessionId?: string;
}): DeliverableRecord {
  if (input.uri) {
    const existing = db.prepare(
      `SELECT * FROM deliverables WHERE mission_id = ? AND uri = ? LIMIT 1`
    ).get(input.missionId, input.uri) as unknown as DeliverableRow | undefined;
    if (existing) return mapDeliverable(existing);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO deliverables (id, mission_id, title, description, uri, status, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(id, input.missionId, input.title, input.description ?? null, input.uri ?? null, input.sessionId ?? null, now, now);
  const row = db.prepare(`SELECT * FROM deliverables WHERE id = ?`).get(id) as unknown as DeliverableRow;
  return mapDeliverable(row);
}

export function updateDeliverable(id: string, patch: Partial<{
  title: string;
  description: string | null;
  uri: string | null;
  status: DeliverableStatus;
}>): DeliverableRecord | undefined {
  const row = db.prepare(`SELECT * FROM deliverables WHERE id = ?`).get(id) as unknown as DeliverableRow | undefined;
  if (!row) return undefined;
  const current = mapDeliverable(row);
  db.prepare(`UPDATE deliverables SET title = ?, description = ?, uri = ?, status = ?, updated_at = ? WHERE id = ?`).run(
    patch.title ?? current.title,
    patch.description !== undefined ? patch.description : current.description,
    patch.uri !== undefined ? patch.uri : current.uri,
    patch.status ?? current.status,
    new Date().toISOString(),
    id
  );
  return mapDeliverable(db.prepare(`SELECT * FROM deliverables WHERE id = ?`).get(id) as unknown as DeliverableRow);
}

export function deleteDeliverable(id: string): void {
  db.prepare(`DELETE FROM deliverables WHERE id = ?`).run(id);
}

interface MissionUpdateRow {
  id: string;
  mission_id: string;
  session_id: string;
  task_id: string | null;
  summary: string;
  proposed_next_action: string | null;
  blocker: string | null;
  artifact_count: number;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

function mapMissionUpdate(row: MissionUpdateRow): MissionUpdateRecord {
  return {
    id: row.id,
    missionId: row.mission_id,
    sessionId: row.session_id,
    taskId: row.task_id,
    summary: row.summary,
    proposedNextAction: row.proposed_next_action,
    blocker: row.blocker,
    artifactCount: row.artifact_count,
    status: row.status as MissionUpdateStatus,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

export function createMissionUpdate(input: {
  missionId: string;
  sessionId: string;
  taskId?: string;
  summary: string;
  proposedNextAction?: string;
  blocker?: string;
  artifactCount: number;
}): MissionUpdateRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mission_updates (id, mission_id, session_id, task_id, summary, proposed_next_action, blocker, artifact_count, status, created_at, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, NULL)`
  ).run(id, input.missionId, input.sessionId, input.taskId ?? null, input.summary, input.proposedNextAction ?? null, input.blocker ?? null, input.artifactCount, now);
  return getMissionUpdate(id)!;
}

export function getMissionUpdate(id: string): MissionUpdateRecord | undefined {
  const row = db.prepare(`SELECT * FROM mission_updates WHERE id = ?`).get(id) as unknown as MissionUpdateRow | undefined;
  return row ? mapMissionUpdate(row) : undefined;
}

export function listMissionUpdates(missionId?: string, agentId?: string): MissionUpdateRecord[] {
  const rows = agentId
    ? missionId
      ? db.prepare(`SELECT u.* FROM mission_updates u JOIN missions m ON m.id = u.mission_id WHERE u.mission_id = ? AND m.agent_id = ? ORDER BY u.created_at DESC`).all(missionId, agentId)
      : db.prepare(`SELECT u.* FROM mission_updates u JOIN missions m ON m.id = u.mission_id WHERE m.agent_id = ? ORDER BY u.created_at DESC`).all(agentId)
    : missionId
      ? db.prepare(`SELECT * FROM mission_updates WHERE mission_id = ? ORDER BY created_at DESC`).all(missionId)
      : db.prepare(`SELECT * FROM mission_updates ORDER BY created_at DESC`).all();
  return (rows as unknown as MissionUpdateRow[]).map(mapMissionUpdate);
}

export function reviewMissionUpdate(id: string, status: Exclude<MissionUpdateStatus, "proposed">): MissionUpdateRecord | undefined {
  const current = getMissionUpdate(id);
  if (!current) return undefined;
  db.prepare(`UPDATE mission_updates SET status = ?, reviewed_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
  return getMissionUpdate(id);
}

interface EvolutionProposalRow {
  id: string;
  agent_id: string | null;
  title: string;
  problem: string;
  expected_value: string;
  change_class: string;
  risk: string;
  stage: string;
  evidence: string | null;
  rollback_plan: string | null;
  lab_session_id: string | null;
  created_at: string;
  updated_at: string;
  promoted_at: string | null;
}

function mapEvolutionProposal(row: EvolutionProposalRow): EvolutionProposalRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    problem: row.problem,
    expectedValue: row.expected_value,
    changeClass: row.change_class as EvolutionChangeClass,
    risk: row.risk as EvolutionRisk,
    stage: row.stage as EvolutionStage,
    evidence: row.evidence,
    rollbackPlan: row.rollback_plan,
    labSessionId: row.lab_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    promotedAt: row.promoted_at,
  };
}

export function createEvolutionProposal(input: {
  title: string;
  problem: string;
  expectedValue: string;
  changeClass: EvolutionChangeClass;
  risk: EvolutionRisk;
  evidence?: string;
  rollbackPlan?: string;
  agentId?: string | null;
}): EvolutionProposalRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO evolution_proposals (id, agent_id, title, problem, expected_value, change_class, risk, stage, evidence, rollback_plan, lab_session_id, created_at, updated_at, promoted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'observed', ?, ?, NULL, ?, ?, NULL)`
  ).run(id, input.agentId ?? DEFAULT_AGENT_ID, input.title, input.problem, input.expectedValue, input.changeClass, input.risk, input.evidence ?? null, input.rollbackPlan ?? null, now, now);
  return getEvolutionProposal(id, input.agentId ?? DEFAULT_AGENT_ID)!;
}

export function getEvolutionProposal(id: string, agentId?: string): EvolutionProposalRecord | undefined {
  const row = (agentId ? db.prepare(`SELECT * FROM evolution_proposals WHERE id = ? AND agent_id = ?`).get(id, agentId) : db.prepare(`SELECT * FROM evolution_proposals WHERE id = ?`).get(id)) as unknown as EvolutionProposalRow | undefined;
  return row ? mapEvolutionProposal(row) : undefined;
}

export function listEvolutionProposals(agentId?: string): EvolutionProposalRecord[] {
  const order = `ORDER BY CASE stage WHEN 'review' THEN 0 WHEN 'building' THEN 1 WHEN 'planned' THEN 2 WHEN 'observed' THEN 3 WHEN 'promoted' THEN 4 ELSE 5 END, updated_at DESC`;
  const rows = agentId ? db.prepare(`SELECT * FROM evolution_proposals WHERE agent_id = ? ${order}`).all(agentId) : db.prepare(`SELECT * FROM evolution_proposals ${order}`).all();
  return (rows as unknown as EvolutionProposalRow[]).map(mapEvolutionProposal);
}

export function updateEvolutionProposal(id: string, patch: Partial<{
  title: string;
  problem: string;
  expectedValue: string;
  changeClass: EvolutionChangeClass;
  risk: EvolutionRisk;
  stage: EvolutionStage;
  evidence: string | null;
  rollbackPlan: string | null;
  labSessionId: string | null;
}>): EvolutionProposalRecord | undefined {
  const current = getEvolutionProposal(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  const stage = patch.stage ?? current.stage;
  const promotedAt = stage === "promoted" && current.stage !== "promoted"
    ? now
    : stage !== "promoted" ? current.promotedAt : current.promotedAt;
  db.prepare(
    `UPDATE evolution_proposals SET title = ?, problem = ?, expected_value = ?, change_class = ?, risk = ?, stage = ?, evidence = ?, rollback_plan = ?, lab_session_id = ?, updated_at = ?, promoted_at = ? WHERE id = ?`
  ).run(
    patch.title ?? current.title,
    patch.problem ?? current.problem,
    patch.expectedValue ?? current.expectedValue,
    patch.changeClass ?? current.changeClass,
    patch.risk ?? current.risk,
    stage,
    patch.evidence !== undefined ? patch.evidence : current.evidence,
    patch.rollbackPlan !== undefined ? patch.rollbackPlan : current.rollbackPlan,
    patch.labSessionId !== undefined ? patch.labSessionId : current.labSessionId,
    now,
    promotedAt,
    id
  );
  return getEvolutionProposal(id);
}

const EVOLUTION_POLICY_DEFAULTS: Record<EvolutionChangeClass, EvolutionAutonomy> = {
  knowledge: "after_checks",
  behavior: "after_checks",
  capability: "approval_required",
  product: "approval_required",
  security: "approval_required",
};

export function listEvolutionPolicies(): EvolutionPolicyRecord[] {
  const rows = db.prepare(`SELECT * FROM evolution_policies`).all() as unknown as Array<{
    change_class: string;
    autonomy: string;
    updated_at: string;
  }>;
  const saved = new Map(rows.map((row) => [row.change_class, row]));
  return (Object.keys(EVOLUTION_POLICY_DEFAULTS) as EvolutionChangeClass[]).map((changeClass) => ({
    changeClass,
    autonomy: (saved.get(changeClass)?.autonomy ?? EVOLUTION_POLICY_DEFAULTS[changeClass]) as EvolutionAutonomy,
    updatedAt: saved.get(changeClass)?.updated_at ?? null,
  }));
}

export function updateEvolutionPolicy(changeClass: EvolutionChangeClass, autonomy: EvolutionAutonomy): EvolutionPolicyRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO evolution_policies (change_class, autonomy, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(change_class) DO UPDATE SET autonomy = excluded.autonomy, updated_at = excluded.updated_at`
  ).run(changeClass, autonomy, now);
  return { changeClass, autonomy, updatedAt: now };
}

export function deleteTask(id: string): void {
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
}

export function linkTaskToSession(taskId: string, sessionId: string): void {
  db.prepare(`UPDATE tasks SET session_id = ?, updated_at = ? WHERE id = ?`).run(
    sessionId,
    new Date().toISOString(),
    taskId
  );
}

const SETTING_DEFAULTS: SettingsRecord = {
  businessContext: "",
  automationsEnabled: true,
  maxConcurrentSessions: 3,
  notifyOnDesktop: true,
  notifyEmail: "",
  notifyPush: false,
  approvalTimeoutMinutes: 240,
  eventRetentionDays: 30,
  dailyPlatformActionCap: 25,
  imagesFolder: "",
  chatWorkingDirectory: "",
};

function readSetting(key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | unknown
    | undefined;
  return row ? (row as { value: string }).value : undefined;
}

function writeSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, new Date().toISOString());
}

export function getSettings(): SettingsRecord {
  const maxRaw = readSetting("max_concurrent_sessions");
  const parsedMax = maxRaw ? Number(maxRaw) : NaN;
  return {
    businessContext: readSetting("business_context") ?? SETTING_DEFAULTS.businessContext,
    automationsEnabled:
      (readSetting("automations_enabled") ?? "true") === "true",
    maxConcurrentSessions:
      Number.isFinite(parsedMax) && parsedMax > 0
        ? parsedMax
        : SETTING_DEFAULTS.maxConcurrentSessions,
    notifyOnDesktop: (readSetting("notify_on_desktop") ?? "true") === "true",
    notifyEmail: readSetting("notify_email") ?? SETTING_DEFAULTS.notifyEmail,
    notifyPush: (readSetting("notify_push") ?? "false") === "true",
    approvalTimeoutMinutes: (() => {
      const raw = readSetting("approval_timeout_minutes");
      if (raw === undefined) return SETTING_DEFAULTS.approvalTimeoutMinutes;
      const parsed = Number(raw);
      // 0 is meaningful here ("wait forever"), so only reject genuinely bad values.
      return Number.isFinite(parsed) && parsed >= 0
        ? parsed
        : SETTING_DEFAULTS.approvalTimeoutMinutes;
    })(),
    eventRetentionDays: (() => {
      const raw = readSetting("event_retention_days");
      if (raw === undefined) return SETTING_DEFAULTS.eventRetentionDays;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0
        ? parsed
        : SETTING_DEFAULTS.eventRetentionDays;
    })(),
    dailyPlatformActionCap: (() => {
      const raw = readSetting("daily_platform_action_cap");
      if (raw === undefined) return SETTING_DEFAULTS.dailyPlatformActionCap;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0
        ? parsed
        : SETTING_DEFAULTS.dailyPlatformActionCap;
    })(),
    imagesFolder: readSetting("images_folder") ?? SETTING_DEFAULTS.imagesFolder,
    chatWorkingDirectory:
      readSetting("chat_working_directory") ?? SETTING_DEFAULTS.chatWorkingDirectory,
  };
}

export function updateSettings(
  patch: Partial<SettingsRecord>
): SettingsRecord {
  if (patch.businessContext !== undefined) {
    writeSetting("business_context", patch.businessContext);
  }
  if (patch.automationsEnabled !== undefined) {
    writeSetting("automations_enabled", patch.automationsEnabled ? "true" : "false");
  }
  if (patch.maxConcurrentSessions !== undefined) {
    writeSetting("max_concurrent_sessions", String(patch.maxConcurrentSessions));
  }
  if (patch.notifyOnDesktop !== undefined) {
    writeSetting("notify_on_desktop", patch.notifyOnDesktop ? "true" : "false");
  }
  if (patch.notifyEmail !== undefined) {
    writeSetting("notify_email", patch.notifyEmail);
  }
  if (patch.notifyPush !== undefined) {
    writeSetting("notify_push", patch.notifyPush ? "true" : "false");
  }
  if (patch.approvalTimeoutMinutes !== undefined) {
    writeSetting("approval_timeout_minutes", String(patch.approvalTimeoutMinutes));
  }
  if (patch.eventRetentionDays !== undefined) {
    writeSetting("event_retention_days", String(patch.eventRetentionDays));
  }
  if (patch.dailyPlatformActionCap !== undefined) {
    writeSetting("daily_platform_action_cap", String(patch.dailyPlatformActionCap));
  }
  if (patch.imagesFolder !== undefined) {
    writeSetting("images_folder", patch.imagesFolder.trim());
  }
  if (patch.chatWorkingDirectory !== undefined) {
    writeSetting("chat_working_directory", patch.chatWorkingDirectory.trim());
  }
  return getSettings();
}

interface ScheduledTaskRow {
  id: string;
  agent_id: string | null;
  prompt: string;
  cwd: string;
  permission_mode: string;
  allowed_tools: string | null;
  time_of_day: string;
  days_of_week: string;
  enabled: number;
  last_run_at: string | null;
  last_session_id: string | null;
  next_run_at: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

function mapScheduledTask(row: ScheduledTaskRow): ScheduledTaskRecord {
  return {
    id: row.id,
    agentId: row.agent_id ?? null,
    prompt: row.prompt,
    cwd: row.cwd,
    permissionMode: row.permission_mode,
    allowedTools: row.allowed_tools ? JSON.parse(row.allowed_tools) : null,
    timeOfDay: row.time_of_day,
    daysOfWeek: JSON.parse(row.days_of_week),
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    lastSessionId: row.last_session_id,
    nextRunAt: row.next_run_at,
    retryCount: row.retry_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createScheduledTask(input: {
  prompt: string;
  cwd: string;
  permissionMode: string;
  allowedTools?: string[];
  timeOfDay: string;
  daysOfWeek: number[];
  nextRunAt: string;
  agentId?: string | null;
}): ScheduledTaskRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO scheduled_tasks (id, agent_id, prompt, cwd, permission_mode, allowed_tools, time_of_day, days_of_week, enabled, last_run_at, last_session_id, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?, ?)`
  ).run(
    id,
    input.agentId ?? null,
    input.prompt,
    input.cwd,
    input.permissionMode,
    input.allowedTools ? JSON.stringify(input.allowedTools) : null,
    input.timeOfDay,
    JSON.stringify(input.daysOfWeek),
    input.nextRunAt,
    now,
    now
  );
  return getScheduledTask(id)!;
}

export function getScheduledTask(id: string): ScheduledTaskRecord | undefined {
  const row = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id) as
    | unknown
    | undefined;
  return row ? mapScheduledTask(row as ScheduledTaskRow) : undefined;
}

export function listScheduledTasks(agentId?: string): ScheduledTaskRecord[] {
  const filter = agentFilter(agentId);
  const rows = db
    .prepare(`SELECT * FROM scheduled_tasks${filter.sql} ORDER BY time_of_day ASC`)
    .all(...filter.params) as unknown as ScheduledTaskRow[];
  return rows.map(mapScheduledTask);
}

export function listEnabledScheduledTasks(): ScheduledTaskRecord[] {
  const rows = db
    .prepare(`SELECT * FROM scheduled_tasks WHERE enabled = 1`)
    .all() as unknown as ScheduledTaskRow[];
  return rows.map(mapScheduledTask);
}

export function updateScheduledTask(
  id: string,
  patch: Partial<{
    prompt: string;
    cwd: string;
    permissionMode: string;
    allowedTools: string[] | null;
    timeOfDay: string;
    daysOfWeek: number[];
    enabled: boolean;
    lastRunAt: string;
    lastSessionId: string;
    nextRunAt: string | null;
    retryCount: number;
  }>
): ScheduledTaskRecord | undefined {
  const current = getScheduledTask(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE scheduled_tasks SET prompt = ?, cwd = ?, permission_mode = ?, allowed_tools = ?, time_of_day = ?, days_of_week = ?, enabled = ?, last_run_at = ?, last_session_id = ?, next_run_at = ?, retry_count = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.prompt ?? current.prompt,
    patch.cwd ?? current.cwd,
    patch.permissionMode ?? current.permissionMode,
    patch.allowedTools !== undefined
      ? patch.allowedTools
        ? JSON.stringify(patch.allowedTools)
        : null
      : current.allowedTools
        ? JSON.stringify(current.allowedTools)
        : null,
    patch.timeOfDay ?? current.timeOfDay,
    JSON.stringify(patch.daysOfWeek ?? current.daysOfWeek),
    (patch.enabled ?? current.enabled) ? 1 : 0,
    patch.lastRunAt ?? current.lastRunAt,
    patch.lastSessionId ?? current.lastSessionId,
    patch.nextRunAt !== undefined ? patch.nextRunAt : current.nextRunAt,
    patch.retryCount ?? current.retryCount,
    now,
    id
  );
  return getScheduledTask(id);
}

export function deleteScheduledTask(id: string): void {
  db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id);
}

/**
 * The one ongoing conversation with Jarvis.
 *
 * Every launch used to create a new session, so talking to Jarvis twice produced
 * two unrelated threads and the list filled with disposable rows. The chat has a
 * single durable session that is resumed rather than replaced; automation runs
 * stay separate because each really is its own execution.
 */
export function getPrimarySessionId(): string | null {
  return readSetting("primary_session_id") ?? null;
}

export function setPrimarySessionId(id: string): void {
  writeSetting("primary_session_id", id);
}

/**
 * The ongoing conversation belonging to one agent.
 *
 * Reads `agents.chat_session_id`, which replaced the single
 * `settings.primary_session_id` in v2 — each agent keeps its own thread rather
 * than sharing one global conversation.
 */
export function getAgentChatSessionId(agentId: string, model: ChatModel = "claude"): string | null {
  const column = model === "gpt-5.6-sol" ? "codex_chat_session_id" : "chat_session_id";
  const row = db
    .prepare(`SELECT ${column} AS session_id FROM agents WHERE id = ?`)
    .get(agentId) as unknown as { session_id: string | null } | undefined;
  return row?.session_id ?? null;
}

export function setAgentChatSessionId(agentId: string, sessionId: string | null, model: ChatModel = "claude"): void {
  const column = model === "gpt-5.6-sol" ? "codex_chat_session_id" : "chat_session_id";
  db.prepare(`UPDATE agents SET ${column} = ?, updated_at = ? WHERE id = ?`).run(
    sessionId,
    new Date().toISOString(),
    agentId
  );
}

/** Removes a session and its transcript. Refuses nothing — callers check status. */
export function deleteSession(id: string): void {
  db.prepare(`DELETE FROM session_events WHERE session_id = ?`).run(id);
  // These legacy reference columns do not yet carry SQL foreign-key clauses,
  // so clear them explicitly before deleting the session.
  db.prepare(
    `UPDATE scheduled_tasks SET last_session_id = NULL WHERE last_session_id = ?`
  ).run(id);
  db.prepare(`UPDATE tasks SET session_id = NULL WHERE session_id = ?`).run(id);
  db.prepare(`DELETE FROM notifications WHERE session_id = ?`).run(id);
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  // If the conversation itself was deleted, stop pointing at it — from the
  // legacy global setting and from whichever agent held it as its thread.
  if (getPrimarySessionId() === id) writeSetting("primary_session_id", "");
  db.prepare(`UPDATE agents SET chat_session_id = NULL WHERE chat_session_id = ?`).run(id);
  db.prepare(`UPDATE agents SET codex_chat_session_id = NULL WHERE codex_chat_session_id = ?`).run(id);
}
