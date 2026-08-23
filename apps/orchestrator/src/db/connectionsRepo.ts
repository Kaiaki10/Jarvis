import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { decryptJson, encryptJson, maskValue } from "../security/secretStore.js";
import { getPlatform } from "../platforms/definitions.js";
import type { ConnectionRecord, ConnectionStatus } from "@jarvis/shared";

interface ConnectionRow {
  id: string;
  agent_id: string | null;
  label: string | null;
  daily_action_cap: number | null;
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
    id: row.id,
    agentId: row.agent_id,
    label: row.label,
    dailyActionCap: row.daily_action_cap,
    platformId: row.platform_id,
    status: row.status as ConnectionStatus,
    detail: row.detail,
    errorMessage: row.error_message,
    fieldHints,
    lastTestedAt: row.last_tested_at,
    updatedAt: row.updated_at,
  };
}

function allRows(): ConnectionRow[] {
  return db.prepare(`SELECT * FROM connections`).all() as unknown as ConnectionRow[];
}

/**
 * Accounts an agent may act as: its own, plus the shared pool.
 *
 * Passing no agent returns every account, which is what the Connections page
 * and the credential backup want — they administer accounts rather than act
 * as one.
 */
export function listConnections(agentId?: string | null): ConnectionRecord[] {
  const rows = agentId
    ? (db
        .prepare(`SELECT * FROM connections WHERE agent_id = ? OR agent_id IS NULL`)
        .all(agentId) as unknown as ConnectionRow[])
    : allRows();
  return rows.map(mapConnection);
}

export function getConnectionById(id: string): ConnectionRecord | undefined {
  const row = db.prepare(`SELECT * FROM connections WHERE id = ?`).get(id) as unknown | undefined;
  return row ? mapConnection(row as ConnectionRow) : undefined;
}

/**
 * The one account meant by a bare platform name.
 *
 * Callers that predate multi-account — Stripe, Coinbase, push, notification
 * email, the Slack bridge, the ad adapters — ask this way, and there is no
 * agent in scope to narrow it. The rule:
 *
 *   1. the shared account, if there is one;
 *   2. the only account, if there is exactly one;
 *   3. nothing.
 *
 * Case 3 is deliberate. With two agent-owned X accounts and nothing shared,
 * "the X account" has no answer, and picking one would post as the wrong
 * business. An undefined here surfaces as a visible failure; a guess would
 * surface as a public mistake.
 */
function resolveByPlatform(platformId: string): ConnectionRow | undefined {
  const rows = db
    .prepare(`SELECT * FROM connections WHERE platform_id = ?`)
    .all(platformId) as unknown as ConnectionRow[];
  if (rows.length === 0) return undefined;
  const shared = rows.find((row) => row.agent_id === null);
  if (shared) return shared;
  return rows.length === 1 ? rows[0] : undefined;
}

export function getConnection(platformId: string): ConnectionRecord | undefined {
  const row = resolveByPlatform(platformId);
  return row ? mapConnection(row) : undefined;
}

function decrypt(row: ConnectionRow | undefined): Record<string, string> | undefined {
  if (!row) return undefined;
  try {
    return decryptJson<Record<string, string>>(row.credentials);
  } catch {
    return undefined;
  }
}

/** Decrypted credentials — orchestrator-internal only, never serialized to a client. */
export function getConnectionCredentials(
  platformId: string
): Record<string, string> | undefined {
  return decrypt(resolveByPlatform(platformId));
}

/** Decrypted credentials for one specific account. */
export function getConnectionCredentialsById(
  id: string
): Record<string, string> | undefined {
  const row = db.prepare(`SELECT * FROM connections WHERE id = ?`).get(id) as
    | ConnectionRow
    | undefined;
  return decrypt(row);
}

/**
 * Creates an account, or replaces the credentials of an existing one.
 *
 * Without an `id` this targets the account a bare platform name resolves to,
 * which keeps the original single-account setup flow working. Pass `id` to
 * edit a specific account, or `agentId`/`label` to add another.
 */
export function saveConnection(
  platformId: string,
  values: Record<string, string>,
  options: { id?: string; agentId?: string | null; label?: string | null; forceNew?: boolean } = {}
): ConnectionRecord {
  const now = new Date().toISOString();
  // forceNew skips resolution entirely: without it a second account would
  // update the first rather than being added alongside it.
  const existing = options.forceNew
    ? undefined
    : options.id
      ? (db.prepare(`SELECT * FROM connections WHERE id = ?`).get(options.id) as
          | ConnectionRow
          | undefined)
      : resolveByPlatform(platformId);

  if (existing) {
    db.prepare(
      `UPDATE connections SET credentials = ?, status = 'not_connected', detail = NULL,
         error_message = NULL, last_tested_at = NULL, label = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      encryptJson(values),
      options.label !== undefined ? options.label : existing.label,
      now,
      existing.id
    );
    return getConnectionById(existing.id)!;
  }

  const id = options.id ?? randomUUID();
  db.prepare(
    `INSERT INTO connections (id, agent_id, label, platform_id, credentials, status,
                              detail, error_message, last_tested_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'not_connected', NULL, NULL, NULL, ?, ?)`
  ).run(id, options.agentId ?? null, options.label ?? null, platformId, encryptJson(values), now, now);
  return getConnectionById(id)!;
}

export function recordTestResult(
  connectionId: string,
  ok: boolean,
  detail: string | null,
  errorMessage: string | null
): ConnectionRecord | undefined {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE connections SET status = ?, detail = ?, error_message = ?, last_tested_at = ?, updated_at = ? WHERE id = ?`
  ).run(ok ? "connected" : "error", detail, errorMessage, now, now, connectionId);
  return getConnectionById(connectionId);
}

export function deleteConnection(connectionId: string): void {
  db.prepare(`DELETE FROM connections WHERE id = ?`).run(connectionId);
}

/** The account a bare platform name resolves to, for callers holding only a platform. */
export function resolveConnectionId(platformId: string): string | undefined {
  return resolveByPlatform(platformId)?.id;
}

interface ExportedCredential {
  platformId: string;
  agentId: string | null;
  label: string | null;
  values: Record<string, string>;
}

/**
 * Every stored credential, decrypted. Only for building a passphrase-protected
 * backup — never return this from an API response.
 *
 * Keyed by connection id rather than platform, because a platform can now hold
 * several accounts and the old shape could only carry one of them.
 */
export function exportAllCredentials(): Record<string, ExportedCredential> {
  const out: Record<string, ExportedCredential> = {};
  for (const row of allRows()) {
    const values = decrypt(row);
    // A row we can't decrypt is already lost; skip it rather than fail the backup.
    if (!values) continue;
    out[row.id] = {
      platformId: row.platform_id,
      agentId: row.agent_id,
      label: row.label,
      values,
    };
  }
  return out;
}

/**
 * Restores credentials from a backup. Status is reset rather than assumed — a token
 * that worked when the backup was taken may have been revoked since, and claiming
 * "connected" without checking would be a lie.
 *
 * Accepts both the current shape and the pre-multi-account one, where the key was
 * the platform id and the value was the credential map itself. Older backups stay
 * restorable; refusing them would strand the only copy some installs have.
 */
export function importCredentials(
  bundle: Record<string, ExportedCredential | Record<string, string>>
): { restored: string[]; skipped: string[] } {
  const restored: string[] = [];
  const skipped: string[] = [];

  for (const [key, entry] of Object.entries(bundle)) {
    const modern =
      entry && typeof entry === "object" && "values" in entry && "platformId" in entry;
    const platformId = modern ? (entry as ExportedCredential).platformId : key;
    const values = modern
      ? (entry as ExportedCredential).values
      : (entry as Record<string, string>);

    if (!getPlatform(platformId)) {
      skipped.push(platformId);
      continue;
    }

    saveConnection(platformId, values, {
      id: modern ? key : undefined,
      agentId: modern ? (entry as ExportedCredential).agentId : null,
      label: modern ? (entry as ExportedCredential).label : null,
    });
    restored.push(platformId);
  }

  return { restored, skipped };
}

/**
 * Sets or clears an account's daily action cap.
 *
 * `null` clears the override so the account falls back to the global default —
 * clearing must not mean "unlimited", or a tidy-up would silently remove the
 * only limit on an account.
 */
export function setConnectionCap(connectionId: string, cap: number | null): ConnectionRecord | undefined {
  db.prepare(`UPDATE connections SET daily_action_cap = ?, updated_at = ? WHERE id = ?`)
    .run(cap, new Date().toISOString(), connectionId);
  return getConnectionById(connectionId);
}

/** The cap that applies to one account: its own override, or null to mean "use the default". */
export function connectionCap(connectionId: string): number | null {
  const row = db
    .prepare(`SELECT daily_action_cap FROM connections WHERE id = ?`)
    .get(connectionId) as unknown as { daily_action_cap: number | null } | undefined;
  return row?.daily_action_cap ?? null;
}
