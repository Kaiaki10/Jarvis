/**
 * CLI: node backupDatabaseTo.js <destPath>
 *
 * An online, transactionally-consistent SQLite snapshot for
 * `scripts/promote-lab.ps1` to keep as a pre-promotion restore point. Uses
 * `node:sqlite`'s `backup()` (db/backup.ts) rather than a raw file copy —
 * the live database is WAL-mode, so a plain copy of `jarvis.db` alone can
 * miss committed data still sitting in `-wal`, while this produces a single
 * complete file that needs no matching sidecar files to restore correctly.
 */
import { createDatabaseBackup } from "../db/backup.js";

const [, , destPath] = process.argv;
if (!destPath) {
  console.error("usage: backupDatabaseTo <destPath>");
  process.exit(1);
}

createDatabaseBackup(destPath)
  .then(() => {
    console.log(`Database snapshot written to ${destPath}`);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
