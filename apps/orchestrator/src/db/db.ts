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

/**
 * The agent every pre-v2 row belongs to.
 *
 * A fixed id rather than a generated one, so the backfill is deterministic and
 * re-running it on an already-migrated database is a no-op rather than a second
 * Jarvis.
 */
export const DEFAULT_AGENT_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Root tables that carry `agent_id`. Children reach their agent through an
 * existing foreign key and are deliberately not listed.
 */
export const AGENT_SCOPED_TABLES = [
  "sessions",
  "scheduled_tasks",
  "tasks",
  "missions",
  "campaigns",
  "paid_growth_campaigns",
  "customers",
  "evolution_proposals",
  "notifications",
] as const;

for (const migration of [
  { table: "platform_actions", column: "content_hash", sql: "ALTER TABLE platform_actions ADD COLUMN content_hash TEXT" },
  { table: "sessions", column: "summary", sql: "ALTER TABLE sessions ADD COLUMN summary TEXT" },
  { table: "sessions", column: "current_activity", sql: "ALTER TABLE sessions ADD COLUMN current_activity TEXT" },
  { table: "sessions", column: "codex_thread_id", sql: "ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT" },
  { table: "sessions", column: "model", sql: "ALTER TABLE sessions ADD COLUMN model TEXT NOT NULL DEFAULT 'claude'" },
  { table: "agents", column: "codex_chat_session_id", sql: "ALTER TABLE agents ADD COLUMN codex_chat_session_id TEXT" },
  { table: "scheduled_tasks", column: "retry_count", sql: "ALTER TABLE scheduled_tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0" },
  { table: "tasks", column: "mission_id", sql: "ALTER TABLE tasks ADD COLUMN mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL" },
  { table: "customer_reply_drafts", column: "confidence", sql: "ALTER TABLE customer_reply_drafts ADD COLUMN confidence REAL" },
  { table: "customer_reply_drafts", column: "requires_approval", sql: "ALTER TABLE customer_reply_drafts ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 1" },
  { table: "customer_reply_drafts", column: "escalation_reason", sql: "ALTER TABLE customer_reply_drafts ADD COLUMN escalation_reason TEXT" },
  { table: "customer_reply_drafts", column: "auto_send", sql: "ALTER TABLE customer_reply_drafts ADD COLUMN auto_send INTEGER NOT NULL DEFAULT 0" },
  { table: "paid_growth_campaigns", column: "external_budget_entity_id", sql: "ALTER TABLE paid_growth_campaigns ADD COLUMN external_budget_entity_id TEXT" },
  // v2: which agent owns the row. Only root tables carry it — everything else
  // (deliverables, content_items, customer_messages, …) reaches its agent
  // through an existing foreign key, so ten columns cover full isolation.
  // `memories` is deliberately absent: splitting it needs a table rebuild to
  // change a UNIQUE constraint, which is sequenced separately (see V2_PLAN.md).
  ...AGENT_SCOPED_TABLES.map((table) => ({
    table,
    column: "agent_id",
    sql: `ALTER TABLE ${table} ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL`,
  })),
]) {
  if (!hasColumn(migration.table, migration.column)) db.exec(migration.sql);
}

/**
 * Turns the pre-v2 database into a single-agent v2 database.
 *
 * Everything that made Jarvis "Jarvis" was a global setting, so agent one is
 * assembled from those rows rather than invented: the business context becomes
 * its system prompt, the chat working directory its cwd, and the primary
 * session its ongoing conversation. Nothing is deleted and no behaviour changes
 * until a second agent exists.
 *
 * Guarded on the agents table being empty, not on a version flag — a database
 * that already has agents is already migrated, and re-running must not mint a
 * duplicate Jarvis.
 */
db.exec(`
  INSERT INTO agents (
    id, name, role, system_prompt, cwd, avatar, color,
    permission_mode, allowed_tools, chat_session_id, status, created_at, updated_at
  )
  SELECT
    '${DEFAULT_AGENT_ID}',
    'Jarvis',
    'Autonomous business system',
    COALESCE((SELECT value FROM settings WHERE key = 'business_context'), ''),
    COALESCE((SELECT value FROM settings WHERE key = 'chat_working_directory'), ''),
    'J',
    'accent',
    'default',
    NULL,
    -- Stored as '' rather than removed when a chat session is deleted, so an
    -- empty string here means "no thread", not a session id of "".
    NULLIF((SELECT value FROM settings WHERE key = 'primary_session_id'), ''),
    'active',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NOT EXISTS (SELECT 1 FROM agents);
`);

// Adopt every pre-v2 row. Scoped to NULL so a row later reassigned to another
// agent is never dragged back to Jarvis on the next restart.
for (const table of AGENT_SCOPED_TABLES) {
  db.prepare(`UPDATE ${table} SET agent_id = ? WHERE agent_id IS NULL`).run(DEFAULT_AGENT_ID);
}

/**
 * Gives memories an owner. The one migration in v2 that rebuilds a table.
 *
 * `normalized_content` was declared `TEXT NOT NULL UNIQUE` inline, and SQLite
 * implements an inline UNIQUE as an implicit index that cannot be dropped — so
 * moving to a per-agent constraint is not an ALTER. Create, copy, drop, rename.
 *
 * Existing memories become the default agent's private memories rather than
 * shared ones. They were learned by the single pre-v2 Jarvis, and promoting
 * them to shared would silently broadcast one agent's preferences to every
 * agent created later. Nothing is lost either way — Jarvis still sees all of
 * them — and a memory can be moved to the shared pool deliberately.
 *
 * Foreign keys are suspended for the swap: rows are copied verbatim, and a
 * `source_session_id` pointing at a session deleted long ago would otherwise
 * abort a migration that is only moving data it already trusted.
 */
if (!hasColumn("memories", "agent_id")) {
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(`
    BEGIN;
    CREATE TABLE memories_v2 (
      id TEXT PRIMARY KEY,
      agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      normalized_content TEXT NOT NULL,
      source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT
    );
    INSERT INTO memories_v2 (id, agent_id, kind, content, normalized_content,
                             source_session_id, status, created_at, updated_at, last_used_at)
      SELECT id, '${DEFAULT_AGENT_ID}', kind, content, normalized_content,
             source_session_id, status, created_at, updated_at, last_used_at
      FROM memories;
    DROP TABLE memories;
    ALTER TABLE memories_v2 RENAME TO memories;
    CREATE INDEX idx_memories_active_updated ON memories(status, updated_at DESC);
    CREATE UNIQUE INDEX idx_memories_agent_normalized
      ON memories(agent_id, normalized_content);
    CREATE UNIQUE INDEX idx_memories_shared_normalized
      ON memories(normalized_content) WHERE agent_id IS NULL;
    COMMIT;
  `);
  db.exec("PRAGMA foreign_keys = ON;");
}

/**
 * Memory uniqueness, in two indexes rather than one, and created here rather
 * than in schema.sql because that file runs before the rebuild above.
 *
 * SQLite treats NULLs as distinct in a UNIQUE index, so
 * UNIQUE(agent_id, normalized_content) does not constrain shared rows at all —
 * every shared memory would look unique and the pool would fill with copies of
 * the same fact. The partial index covers exactly those rows.
 */
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_agent_normalized
    ON memories(agent_id, normalized_content);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_shared_normalized
    ON memories(normalized_content) WHERE agent_id IS NULL;
`);

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_session_seq_unique ON session_events(session_id, seq);");
db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_mission ON tasks(mission_id);");
