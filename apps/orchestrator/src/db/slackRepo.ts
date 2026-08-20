import { db } from "./db.js";

export interface SlackThreadBinding {
  workspaceId: string;
  channelId: string;
  externalThreadId: string;
  agentId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

interface SlackThreadRow {
  workspace_id: string;
  channel_id: string;
  external_thread_id: string;
  agent_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

function mapBinding(row: SlackThreadRow): SlackThreadBinding {
  return {
    workspaceId: row.workspace_id,
    channelId: row.channel_id,
    externalThreadId: row.external_thread_id,
    agentId: row.agent_id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSlackThreadBinding(
  workspaceId: string,
  channelId: string,
  externalThreadId: string
): SlackThreadBinding | undefined {
  const row = db.prepare(
    `SELECT * FROM slack_agent_threads
     WHERE workspace_id = ? AND channel_id = ? AND external_thread_id = ?`
  ).get(workspaceId, channelId, externalThreadId) as unknown as SlackThreadRow | undefined;
  return row ? mapBinding(row) : undefined;
}

export function bindSlackThread(input: {
  workspaceId: string;
  channelId: string;
  externalThreadId: string;
  agentId: string;
  userId: string;
}): SlackThreadBinding {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO slack_agent_threads
       (workspace_id, channel_id, external_thread_id, agent_id, user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, channel_id, external_thread_id) DO UPDATE SET
       agent_id = excluded.agent_id,
       user_id = excluded.user_id,
       updated_at = excluded.updated_at`
  ).run(input.workspaceId, input.channelId, input.externalThreadId, input.agentId, input.userId, now, now);
  return getSlackThreadBinding(input.workspaceId, input.channelId, input.externalThreadId)!;
}

/** Returns false for a Socket Mode redelivery that was already processed. */
export function claimSlackEvent(workspaceId: string, eventId: string, payloadHash: string): boolean {
  const result = db.prepare(
    `INSERT OR IGNORE INTO slack_inbound_events
       (workspace_id, event_id, payload_hash, created_at) VALUES (?, ?, ?, ?)`
  ).run(workspaceId, eventId, payloadHash, new Date().toISOString());
  return result.changes === 1;
}
