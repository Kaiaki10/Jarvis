import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export interface OperatorRecord {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface OperatorCredentialRecord {
  credentialId: string;
  operatorId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface OperatorSessionRecord {
  id: string;
  operatorId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  label: string;
}

export type WebauthnChallengeType = "registration" | "authentication";

export interface WebauthnChallengeRecord {
  id: string;
  type: WebauthnChallengeType;
  challenge: string;
  operatorId: string | null;
  createdAt: string;
  expiresAt: string;
}

interface OperatorRow {
  id: string;
  display_name: string;
  created_at: string;
}

function mapOperator(row: OperatorRow): OperatorRecord {
  return { id: row.id, displayName: row.display_name, createdAt: row.created_at };
}

/** Whether this install already has an operator — the "first run" signal for registration. */
export function countOperators(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM operators").get() as unknown as {
    count: number;
  };
  return row.count;
}

export function createOperator(displayName: string): OperatorRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO operators (id, display_name, created_at) VALUES (?, ?, ?)").run(
    id,
    displayName.trim() || "Operator",
    now
  );
  return { id, displayName: displayName.trim() || "Operator", createdAt: now };
}

export function getOperator(id: string): OperatorRecord | undefined {
  const row = db.prepare("SELECT * FROM operators WHERE id = ?").get(id) as unknown as
    | OperatorRow
    | undefined;
  return row ? mapOperator(row) : undefined;
}

interface CredentialRow {
  credential_id: string;
  operator_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_label: string;
  created_at: string;
  last_used_at: string | null;
}

function mapCredential(row: CredentialRow): OperatorCredentialRecord {
  return {
    credentialId: row.credential_id,
    operatorId: row.operator_id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: row.transports ? (JSON.parse(row.transports) as string[]) : null,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function addCredential(input: {
  credentialId: string;
  operatorId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceLabel?: string;
}): OperatorCredentialRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO operator_credentials
       (credential_id, operator_id, public_key, counter, transports, device_label, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    input.credentialId,
    input.operatorId,
    input.publicKey,
    input.counter,
    input.transports ? JSON.stringify(input.transports) : null,
    input.deviceLabel?.trim() || "",
    now
  );
  return getCredential(input.credentialId)!;
}

export function getCredential(credentialId: string): OperatorCredentialRecord | undefined {
  const row = db
    .prepare("SELECT * FROM operator_credentials WHERE credential_id = ?")
    .get(credentialId) as unknown as CredentialRow | undefined;
  return row ? mapCredential(row) : undefined;
}

export function listCredentialsForOperator(operatorId: string): OperatorCredentialRecord[] {
  const rows = db
    .prepare("SELECT * FROM operator_credentials WHERE operator_id = ? ORDER BY created_at ASC")
    .all(operatorId) as unknown as CredentialRow[];
  return rows.map(mapCredential);
}

/** Every credential across every operator — WebAuthn matches on credential id alone, not per-operator. */
export function listAllCredentials(): OperatorCredentialRecord[] {
  const rows = db.prepare("SELECT * FROM operator_credentials").all() as unknown as CredentialRow[];
  return rows.map(mapCredential);
}

/** Persists the authenticator's reported use count. A stale counter is how a cloned authenticator gets caught. */
export function touchCredential(credentialId: string, counter: number): void {
  db.prepare(
    "UPDATE operator_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?"
  ).run(counter, new Date().toISOString(), credentialId);
}

interface SessionRow {
  id: string;
  operator_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  label: string;
}

function mapSession(row: SessionRow): OperatorSessionRecord {
  return {
    id: row.id,
    operatorId: row.operator_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    label: row.label,
  };
}

export function createOperatorSession(input: {
  operatorId: string;
  ttlMs: number;
  label?: string;
}): OperatorSessionRecord {
  const id = randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
  db.prepare(
    `INSERT INTO operator_sessions (id, operator_id, created_at, expires_at, last_seen_at, label)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.operatorId, nowIso, expiresAt, nowIso, input.label?.trim() ?? "");
  return { id, operatorId: input.operatorId, createdAt: nowIso, expiresAt, lastSeenAt: nowIso, label: input.label?.trim() ?? "" };
}

/** Returns the session only if it exists and has not expired. */
export function getValidOperatorSession(id: string): OperatorSessionRecord | undefined {
  const row = db.prepare("SELECT * FROM operator_sessions WHERE id = ?").get(id) as unknown as
    | SessionRow
    | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return mapSession(row);
}

export function touchOperatorSession(id: string): void {
  db.prepare("UPDATE operator_sessions SET last_seen_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id
  );
}

export function deleteOperatorSession(id: string): void {
  db.prepare("DELETE FROM operator_sessions WHERE id = ?").run(id);
}

function pruneExpiredChallenges(): void {
  db.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= ?").run(new Date().toISOString());
}

export function createWebauthnChallenge(input: {
  type: WebauthnChallengeType;
  challenge: string;
  operatorId?: string | null;
  ttlMs: number;
}): string {
  pruneExpiredChallenges();
  const id = randomUUID();
  const now = new Date();
  db.prepare(
    `INSERT INTO webauthn_challenges (id, type, challenge, operator_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.type,
    input.challenge,
    input.operatorId ?? null,
    now.toISOString(),
    new Date(now.getTime() + input.ttlMs).toISOString()
  );
  return id;
}

/** Single-use: deletes the row whether or not it is returned, so a ceremony can never be replayed. */
export function consumeWebauthnChallenge(id: string): WebauthnChallengeRecord | undefined {
  const row = db.prepare("SELECT * FROM webauthn_challenges WHERE id = ?").get(id) as unknown as
    | {
        id: string;
        type: string;
        challenge: string;
        operator_id: string | null;
        created_at: string;
        expires_at: string;
      }
    | undefined;
  db.prepare("DELETE FROM webauthn_challenges WHERE id = ?").run(id);
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return {
    id: row.id,
    type: row.type as WebauthnChallengeType,
    challenge: row.challenge,
    operatorId: row.operator_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
