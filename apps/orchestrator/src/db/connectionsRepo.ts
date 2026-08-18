import { db } from "./db.js";
import { decryptJson, encryptJson, maskValue } from "../security/secretStore.js";
import { getPlatform } from "../platforms/definitions.js";
import type { ConnectionRecord, ConnectionStatus } from "@jarvis/shared";

interface ConnectionRow {
  platform_id: string;
  credentials: string;
  status: string;
  detail: string | null;
  error_message: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Maps a stored row to its API shape. Decrypted values are reduced to masked
 * hints here so raw credentials never reach a response body.
 */
function mapConnection(row: ConnectionRow): ConnectionRecord {
  const platform = getPlatform(row.platform_id);
  let fieldHints: Record<string, string> = {};
  try {
    const values = decryptJson<Record<string, string>>(row.credentials);
    for (const field of platform?.definition.fields ?? []) {
      const value = values[field.key];
      if (!value) continue;
      fieldHints[field.key] = field.secret ? maskValue(value) : value;
    }
  } catch {
    fieldHints = {};
  }
  return {
    platformId: row.platform_id,
    status: row.status as ConnectionStatus,
    detail: row.detail,
    errorMessage: row.error_message,
    fieldHints,
    lastTestedAt: row.last_tested_at,
    updatedAt: row.updated_at,
  };
}

export function listConnections(): ConnectionRecord[] {
  const rows = db.prepare(`SELECT * FROM connections`).all() as unknown as ConnectionRow[];
  return rows.map(mapConnection);
}

export function getConnection(platformId: string): ConnectionRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM connections WHERE platform_id = ?`)
    .get(platformId) as unknown | undefined;
  return row ? mapConnection(row as ConnectionRow) : undefined;
}

/** Decrypted credentials — orchestrator-internal only, never serialized to a client. */
export function getConnectionCredentials(
  platformId: string
): Record<string, string> | undefined {
  const row = db
    .prepare(`SELECT credentials FROM connections WHERE platform_id = ?`)
    .get(platformId) as unknown | undefined;
  if (!row) return undefined;
  try {
    return decryptJson<Record<string, string>>((row as { credentials: string }).credentials);
  } catch {
    return undefined;
  }
}

export function saveConnection(
  platformId: string,
  values: Record<string, string>
): ConnectionRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (platform_id, credentials, status, detail, error_message, last_tested_at, created_at, updated_at)
     VALUES (?, ?, 'not_connected', NULL, NULL, NULL, ?, ?)
     ON CONFLICT(platform_id) DO UPDATE SET
       credentials = excluded.credentials,
       status = 'not_connected',
       detail = NULL,
       error_message = NULL,
       last_tested_at = NULL,
       updated_at = excluded.updated_at`
  ).run(platformId, encryptJson(values), now, now);
  return getConnection(platformId)!;
}

export function recordTestResult(
  platformId: string,
  ok: boolean,
  detail: string | null,
  errorMessage: string | null
): ConnectionRecord | undefined {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE connections SET status = ?, detail = ?, error_message = ?, last_tested_at = ?, updated_at = ? WHERE platform_id = ?`
  ).run(ok ? "connected" : "error", detail, errorMessage, now, now, platformId);
  return getConnection(platformId);
}

export function deleteConnection(platformId: string): void {
  db.prepare(`DELETE FROM connections WHERE platform_id = ?`).run(platformId);
}
