import { randomUUID } from "node:crypto";
import type {
  AgentConversationMessageRecord,
  AgentConversationParticipantRecord,
  AgentConversationRecord,
  AgentConversationStatus,
} from "@jarvis/shared";
import { db } from "./db.js";

interface ConversationRow {
  id: string;
  title: string;
  topic: string;
  status: string;
  turn_cap: number;
  budget_seconds: number;
  turns_used: number;
  started_at: string | null;
  ended_at: string | null;
  stop_reason: string | null;
  created_at: string;
  updated_at: string;
}

function mapConversation(row: ConversationRow): AgentConversationRecord {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    status: row.status as AgentConversationStatus,
    turnCap: row.turn_cap,
    budgetSeconds: row.budget_seconds,
    turnsUsed: row.turns_used,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    stopReason: row.stop_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createConversation(input: {
  title: string;
  topic: string;
  agentIds: string[];
  turnCap?: number;
  budgetSeconds?: number;
}): AgentConversationRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_conversations
       (id, title, topic, status, turn_cap, budget_seconds, turns_used, started_at, ended_at, stop_reason, created_at, updated_at)
     VALUES (?, ?, ?, 'idle', ?, ?, 0, NULL, NULL, NULL, ?, ?)`
  ).run(id, input.title, input.topic, input.turnCap ?? 12, input.budgetSeconds ?? 900, now, now);

  input.agentIds.forEach((agentId, index) => {
    db.prepare(
      `INSERT INTO agent_conversation_participants (conversation_id, agent_id, session_id, position)
       VALUES (?, ?, NULL, ?)`
    ).run(id, agentId, index);
  });

  return getConversation(id)!;
}

export function getConversation(id: string): AgentConversationRecord | undefined {
  const row = db.prepare(`SELECT * FROM agent_conversations WHERE id = ?`).get(id) as unknown as
    | ConversationRow
    | undefined;
  return row ? mapConversation(row) : undefined;
}

export function listConversations(): AgentConversationRecord[] {
  return (
    db
      .prepare(`SELECT * FROM agent_conversations ORDER BY updated_at DESC`)
      .all() as unknown as ConversationRow[]
  ).map(mapConversation);
}

export function updateConversation(
  id: string,
  patch: Partial<{
    status: AgentConversationStatus;
    turnsUsed: number;
    startedAt: string | null;
    endedAt: string | null;
    stopReason: string | null;
  }>
): AgentConversationRecord | undefined {
  const current = getConversation(id);
  if (!current) return undefined;
  db.prepare(
    `UPDATE agent_conversations
     SET status = ?, turns_used = ?, started_at = ?, ended_at = ?, stop_reason = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.status ?? current.status,
    patch.turnsUsed ?? current.turnsUsed,
    patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
    patch.endedAt !== undefined ? patch.endedAt : current.endedAt,
    patch.stopReason !== undefined ? patch.stopReason : current.stopReason,
    new Date().toISOString(),
    id
  );
  return getConversation(id);
}

export function deleteConversation(id: string): void {
  db.prepare(`DELETE FROM agent_conversations WHERE id = ?`).run(id);
}

export function listParticipants(conversationId: string): AgentConversationParticipantRecord[] {
  const rows = db
    .prepare(
      `SELECT p.conversation_id, p.agent_id, p.session_id, p.position, a.name, a.avatar
       FROM agent_conversation_participants p
       JOIN agents a ON a.id = p.agent_id
       WHERE p.conversation_id = ?
       ORDER BY p.position ASC`
    )
    .all(conversationId) as unknown as Array<{
    conversation_id: string;
    agent_id: string;
    session_id: string | null;
    position: number;
    name: string;
    avatar: string;
  }>;
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    position: row.position,
    name: row.name,
    avatar: row.avatar,
  }));
}

export function setParticipantSession(
  conversationId: string,
  agentId: string,
  sessionId: string
): void {
  db.prepare(
    `UPDATE agent_conversation_participants SET session_id = ? WHERE conversation_id = ? AND agent_id = ?`
  ).run(sessionId, conversationId, agentId);
}

export function appendConversationMessage(input: {
  conversationId: string;
  turn: number;
  speakerAgentId: string | null;
  speakerName: string;
  body: string;
}): AgentConversationMessageRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_conversation_messages
       (id, conversation_id, turn, speaker_agent_id, speaker_name, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.conversationId, input.turn, input.speakerAgentId, input.speakerName, input.body, now);
  return {
    id,
    conversationId: input.conversationId,
    turn: input.turn,
    speakerAgentId: input.speakerAgentId,
    speakerName: input.speakerName,
    body: input.body,
    createdAt: now,
  };
}

export function listConversationMessages(
  conversationId: string
): AgentConversationMessageRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_conversation_messages WHERE conversation_id = ? ORDER BY turn ASC, created_at ASC`
    )
    .all(conversationId) as unknown as Array<{
    id: string;
    conversation_id: string;
    turn: number;
    speaker_agent_id: string | null;
    speaker_name: string;
    body: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    turn: row.turn,
    speakerAgentId: row.speaker_agent_id,
    speakerName: row.speaker_name,
    body: row.body,
    createdAt: row.created_at,
  }));
}
