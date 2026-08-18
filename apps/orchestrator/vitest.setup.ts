import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Points every test file at a throwaway database.
 *
 * Importing `db/db.js` opens `jarvis.db` and runs migrations on it. Most test
 * files never touch the database directly, but anything that transitively
 * imports the repo layer opens whatever `JARVIS_DB_PATH` points at — and with
 * no setup that was the real, live production database sitting next to the
 * source.
 *
 * That was survivable while migrations were only `CREATE TABLE IF NOT EXISTS`
 * and `ADD COLUMN`. The v2 agent migration writes rows, so a test run would
 * mutate live data and contend with the running service for the WAL lock,
 * which showed up as an intermittent failure to open the schema at all.
 *
 * Each worker gets its own directory, so parallel files cannot fight over one
 * file. A test that wants a specific database still sets JARVIS_DB_PATH in its
 * own `beforeAll`, which runs after this and therefore wins.
 */
process.env.JARVIS_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "jarvis-test-")),
  "test.db"
);
