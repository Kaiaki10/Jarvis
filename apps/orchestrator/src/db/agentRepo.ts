import { randomUUID } from "node:crypto";
import type { AgentRecord, AgentStatus } from "@jarvis/shared";
import { db, DEFAULT_AGENT_ID } from "./db.js";

interface AgentRow {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
  cwd: string;
  avatar: string;
  color: string;
  permission_mode: string;
  allowed_tools: string | null;
  chat_session_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    systemPrompt: row.system_prompt,
    cwd: row.cwd,
    avatar: row.avatar,
    color: row.color,
    permissionMode: row.permission_mode,
    allowedTools: row.allowed_tools ? (JSON.parse(row.allowed_tools) as string[]) : null,
    chatSessionId: row.chat_session_id,
    status: row.status as AgentStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAgents(status?: AgentStatus): AgentRecord[] {
  const rows = status
    ? db.prepare("SELECT * FROM agents WHERE status = ? ORDER BY name ASC").all(status)
    : db.prepare("SELECT * FROM agents ORDER BY status ASC, name ASC").all();
  return (rows as unknown as AgentRow[]).map(mapAgent);
}

export function getAgent(id: string): AgentRecord | undefined {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as unknown as
    | AgentRow
    | undefined;
  return row ? mapAgent(row) : undefined;
}

/**
 * The agent that owns every pre-v2 row, and the one the dashboard falls back to
 * when no agent has been chosen. Created by the migration in `db.ts`, so this
 * reads rather than creates — a missing default means the migration did not run.
 */
export function getDefaultAgent(): AgentRecord | undefined {
  return getAgent(DEFAULT_AGENT_ID);
}

export function createAgent(input: {
  name: string;
  role?: string;
  systemPrompt?: string;
  cwd?: string;
  avatar?: string;
  color?: string;
  permissionMode?: string;
  allowedTools?: string[] | null;
}): AgentRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agents (
       id, name, role, system_prompt, cwd, avatar, color,
       permission_mode, allowed_tools, chat_session_id, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?)`
  ).run(
    id,
    input.name.trim(),
    input.role?.trim() ?? "",
    input.systemPrompt ?? "",
    input.cwd?.trim() ?? "",
    // A single letter reads correctly in the sidebar badge whether or not the
    // caller supplied an emoji.
    input.avatar?.trim() || input.name.trim().slice(0, 1).toUpperCase(),
    input.color?.trim() || "accent",
    input.permissionMode ?? "default",
    input.allowedTools ? JSON.stringify(input.allowedTools) : null,
    now,
    now
  );
  return getAgent(id)!;
}

export function updateAgent(
  id: string,
  patch: {
    name?: string;
    role?: string;
    systemPrompt?: string;
    cwd?: string;
    avatar?: string;
    color?: string;
    permissionMode?: string;
    allowedTools?: string[] | null;
    chatSessionId?: string | null;
    status?: AgentStatus;
  }
): AgentRecord | undefined {
  if (!getAgent(id)) return undefined;

  const columns: Record<string, unknown> = {};
  if (patch.name !== undefined) columns.name = patch.name.trim();
  if (patch.role !== undefined) columns.role = patch.role.trim();
  if (patch.systemPrompt !== undefined) columns.system_prompt = patch.systemPrompt;
  if (patch.cwd !== undefined) columns.cwd = patch.cwd.trim();
  if (patch.avatar !== undefined) columns.avatar = patch.avatar.trim();
  if (patch.color !== undefined) columns.color = patch.color.trim();
  if (patch.permissionMode !== undefined) columns.permission_mode = patch.permissionMode;
  if (patch.allowedTools !== undefined) {
    columns.allowed_tools = patch.allowedTools ? JSON.stringify(patch.allowedTools) : null;
  }
  if (patch.chatSessionId !== undefined) columns.chat_session_id = patch.chatSessionId;
  if (patch.status !== undefined) columns.status = patch.status;

  const entries = Object.entries(columns);
  if (entries.length) {
    const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
    db.prepare(`UPDATE agents SET ${assignments}, updated_at = ? WHERE id = ?`).run(
      ...entries.map(([, value]) => value as string | number | null),
      new Date().toISOString(),
      id
    );
  }
  return getAgent(id);
}

export type ArchiveAgentOutcome =
  | { ok: true; agent: AgentRecord }
  | { ok: false; reason: "unknown_agent" | "last_active_agent" };

/**
 * Agents are archived, never deleted.
 *
 * Their missions, runs, and customers reference them, and deleting the row
 * would set those to NULL — quietly moving a whole workspace's history into
 * nobody's hands. Archiving keeps the trail attributable.
 */
export function archiveAgent(id: string): ArchiveAgentOutcome {
  const agent = getAgent(id);
  if (!agent) return { ok: false, reason: "unknown_agent" };
  // Archiving the only agent would leave the dashboard with nothing to show and
  // every existing row owned by something the picker refuses to offer.
  const activeCount = listAgents("active").length;
  if (agent.status === "active" && activeCount <= 1) {
    return { ok: false, reason: "last_active_agent" };
  }
  return { ok: true, agent: updateAgent(id, { status: "archived" })! };
}
