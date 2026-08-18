import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH =
  process.env.JARVIS_DB_PATH ?? join(__dirname, "..", "..", "jarvis.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(readFileSync(join(__dirname, "schema.sql"), "utf-8"));

/**
 * Columns added after a table shipped. SQLite has no ADD COLUMN IF NOT EXISTS,
 * and re-running a plain ALTER throws, so each is attempted and ignored when it
 * is already there. Kept here so an existing database upgrades on start.
 */
for (const statement of [
  "ALTER TABLE platform_actions ADD COLUMN content_hash TEXT",
  "ALTER TABLE sessions ADD COLUMN summary TEXT",
  "ALTER TABLE sessions ADD COLUMN current_activity TEXT",
]) {
  try {
    db.exec(statement);
  } catch {
    // Already applied.
  }
}
