import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH =
  process.env.JARVIS_DB_PATH ?? join(__dirname, "..", "..", "jarvis.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(readFileSync(join(__dirname, "schema.sql"), "utf-8"));

/**
 * Columns added after a table shipped. SQLite has no ADD COLUMN IF NOT EXISTS,
 * so inspect table metadata before each explicit upgrade. Unexpected migration
 * failures must stop startup instead of being mistaken for "already applied".
 */
function hasColumn(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string;
  }>;
  return rows.some((row) => row.name === column);
}

for (const migration of [
  { table: "platform_actions", column: "content_hash", sql: "ALTER TABLE platform_actions ADD COLUMN content_hash TEXT" },
  { table: "sessions", column: "summary", sql: "ALTER TABLE sessions ADD COLUMN summary TEXT" },
  { table: "sessions", column: "current_activity", sql: "ALTER TABLE sessions ADD COLUMN current_activity TEXT" },
  { table: "scheduled_tasks", column: "retry_count", sql: "ALTER TABLE scheduled_tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0" },
  { table: "tasks", column: "mission_id", sql: "ALTER TABLE tasks ADD COLUMN mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL" },
  { table: "customer_reply_drafts", column: "confidence", sql: "ALTER TABLE customer_reply_drafts ADD COLUMN confidence REAL" },
  { table: "customer_reply_drafts", column: "requires_approval", sql: "ALTER TABLE customer_reply_drafts ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 1" },
  { table: "customer_reply_drafts", column: "escalation_reason", sql: "ALTER TABLE customer_reply_drafts ADD COLUMN escalation_reason TEXT" },
  { table: "customer_reply_drafts", column: "auto_send", sql: "ALTER TABLE customer_reply_drafts ADD COLUMN auto_send INTEGER NOT NULL DEFAULT 0" },
  { table: "paid_growth_campaigns", column: "external_budget_entity_id", sql: "ALTER TABLE paid_growth_campaigns ADD COLUMN external_budget_entity_id TEXT" },
]) {
  if (!hasColumn(migration.table, migration.column)) db.exec(migration.sql);
}

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_session_seq_unique ON session_events(session_id, seq);");
db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_mission ON tasks(mission_id);");
