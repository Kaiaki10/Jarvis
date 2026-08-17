import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import type {
  SessionRecord,
  SessionEventRecord,
  SessionEventType,
  SessionStatus,
  TaskRecord,
  TaskStatus,
} from "@jarvis/shared";

interface SessionRow {
  id: string;
  claude_session_id: string | null;
  title: string;
  status: string;
  cwd: string;
  permission_mode: string;
  allowed_tools: string | null;
  task_id: string | null;
  cost_usd: number | null;
  turns: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    claudeSessionId: row.claude_session_id,
    title: row.title,
    status: row.status as SessionStatus,
    cwd: row.cwd,
    permissionMode: row.permission_mode,
    allowedTools: row.allowed_tools ? JSON.parse(row.allowed_tools) : null,
    taskId: row.task_id,
    costUsd: row.cost_usd,
    turns: row.turns,
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
}): SessionRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, claude_session_id, title, status, cwd, permission_mode, allowed_tools, task_id, cost_usd, turns, error_message, created_at, updated_at)
     VALUES (?, NULL, ?, 'starting', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
  ).run(
    id,
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

export function listSessions(): SessionRecord[] {
  const rows = db
    .prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`)
    .all() as unknown as SessionRow[];
  return rows.map(mapSession);
}

export function updateSession(
  id: string,
  patch: Partial<{
    claudeSessionId: string;
    status: SessionStatus;
    costUsd: number;
    turns: number;
    errorMessage: string;
  }>
): void {
  const current = getSession(id);
  if (!current) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET claude_session_id = ?, status = ?, cost_usd = ?, turns = ?, error_message = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.claudeSessionId ?? current.claudeSessionId,
    patch.status ?? current.status,
    patch.costUsd ?? current.costUsd,
    patch.turns ?? current.turns,
    patch.errorMessage ?? current.errorMessage,
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
    .run(sessionId, seq, type, JSON.stringify(payload), now);
  return {
    id: Number(result.lastInsertRowid),
    sessionId,
    seq,
    type,
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

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  position: number;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    position: row.position,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function createTask(input: {
  title: string;
  description?: string;
}): TaskRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  const maxPosRow = db
    .prepare(`SELECT COALESCE(MAX(position), 0) as maxPos FROM tasks`)
    .get() as { maxPos: number };
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, position, session_id, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, 'todo', ?, NULL, ?, ?, NULL)`
  ).run(id, input.title, input.description ?? null, maxPosRow.maxPos + 1, now, now);
  return getTask(id)!;
}

export function getTask(id: string): TaskRecord | undefined {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | unknown
    | undefined;
  return row ? mapTask(row as TaskRow) : undefined;
}

export function listTasks(): TaskRecord[] {
  const rows = db
    .prepare(`SELECT * FROM tasks ORDER BY status ASC, position ASC`)
    .all() as unknown as TaskRow[];
  return rows.map(mapTask);
}

export function updateTask(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    status: TaskStatus;
    position: number;
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
    `UPDATE tasks SET title = ?, description = ?, status = ?, position = ?, updated_at = ?, completed_at = ? WHERE id = ?`
  ).run(
    patch.title ?? current.title,
    patch.description !== undefined ? patch.description : current.description,
    patch.status ?? current.status,
    patch.position ?? current.position,
    now,
    completedAt,
    id
  );
  return getTask(id);
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
