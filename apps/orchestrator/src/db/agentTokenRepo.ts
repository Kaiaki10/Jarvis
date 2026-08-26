import { randomBytes } from "node:crypto";
import { db } from "./db.js";

export interface AgentTokenRecord {
  token: string;
  agentId: string;
  operatorId: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
}

interface AgentTokenRow {
  token: string;
  agent_id: string;
  operator_id: string | null;
  created_at: string;
  expires_at: string;
  last_used_at: string;
}

function mapAgentToken(row: AgentTokenRow): AgentTokenRecord {
  return {
    token: row.token,
    agentId: row.agent_id,
    operatorId: row.operator_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Entropy matches `apiToken.ts`'s master token, not `operatorRepo.ts`'s
 * `randomUUID()` session ids -- this value travels as a bearer header on every
 * request rather than sitting in an `HttpOnly` cookie, so it needs the same bar.
 */
export function createAgentToken(input: {
  agentId: string;
  operatorId: string | null;
  ttlMs: number;
}): AgentTokenRecord {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
  db.prepare(
    `INSERT INTO agent_tokens (token, agent_id, operator_id, created_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(token, input.agentId, input.operatorId, nowIso, expiresAt, nowIso);
  return { token, agentId: input.agentId, operatorId: input.operatorId, createdAt: nowIso, expiresAt, lastUsedAt: nowIso };
}

/** Returns the token record only if it exists and has not expired -- same shape as operatorRepo's getValidOperatorSession. */
export function getValidAgentToken(token: string): AgentTokenRecord | undefined {
  const row = db.prepare("SELECT * FROM agent_tokens WHERE token = ?").get(token) as unknown as AgentTokenRow | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return mapAgentToken(row);
}

export function touchAgentToken(token: string): void {
  db.prepare("UPDATE agent_tokens SET last_used_at = ? WHERE token = ?").run(new Date().toISOString(), token);
}
