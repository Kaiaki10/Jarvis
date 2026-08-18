import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import type {
  SessionRecord,
  SessionEventRecord,
  SessionEventType,
  SessionStatus,
  ScheduledTaskRecord,
  SettingsRecord,
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

const SETTING_DEFAULTS: SettingsRecord = {
  businessContext: "",
  automationsEnabled: true,
  maxConcurrentSessions: 3,
  notifyOnDesktop: true,
  notifyEmail: "",
  approvalTimeoutMinutes: 240,
  eventRetentionDays: 30,
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
  if (patch.approvalTimeoutMinutes !== undefined) {
    writeSetting("approval_timeout_minutes", String(patch.approvalTimeoutMinutes));
  }
  if (patch.eventRetentionDays !== undefined) {
    writeSetting("event_retention_days", String(patch.eventRetentionDays));
  }
  return getSettings();
}

interface ScheduledTaskRow {
  id: string;
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
  created_at: string;
  updated_at: string;
}

function mapScheduledTask(row: ScheduledTaskRow): ScheduledTaskRecord {
  return {
    id: row.id,
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
}): ScheduledTaskRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO scheduled_tasks (id, prompt, cwd, permission_mode, allowed_tools, time_of_day, days_of_week, enabled, last_run_at, last_session_id, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?, ?)`
  ).run(
    id,
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

export function listScheduledTasks(): ScheduledTaskRecord[] {
  const rows = db
    .prepare(`SELECT * FROM scheduled_tasks ORDER BY time_of_day ASC`)
    .all() as unknown as ScheduledTaskRow[];
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
  }>
): ScheduledTaskRecord | undefined {
  const current = getScheduledTask(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE scheduled_tasks SET prompt = ?, cwd = ?, permission_mode = ?, allowed_tools = ?, time_of_day = ?, days_of_week = ?, enabled = ?, last_run_at = ?, last_session_id = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
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
    now,
    id
  );
  return getScheduledTask(id);
}

export function deleteScheduledTask(id: string): void {
  db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id);
}
