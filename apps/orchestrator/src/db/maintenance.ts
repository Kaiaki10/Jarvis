import { statSync } from "node:fs";
import { db, DB_PATH } from "./db.js";
import { getSettings } from "./repo.js";

/**
 * Keeps the event log from growing without bound.
 *
 * `stream_event` rows are the token-by-token deltas used to render a turn as it
 * happens. Once the turn ends the `assistant` event holds the same text in full,
 * so for a finished session they are pure redundancy — and they dominate the
 * table (measured at 96% of rows and 73% of bytes). Dropping them leaves the
 * readable transcript completely intact.
 */

/** Sessions still in flight, whose deltas the UI may still be rendering. */
const LIVE_STATUSES = ["running", "starting", "waiting_permission"];

/** Leave a just-finished session alone briefly, in case someone is watching it. */
const COMPACT_GRACE_MS = 60 * 60 * 1000;

export interface StorageStats {
  dbBytes: number;
  totalEvents: number;
  streamEvents: number;
  compactableEvents: number;
  sessions: number;
}

export function getStorageStats(): StorageStats {
  // The -wal file is real disk usage and can dwarf the main file between
  // checkpoints, so reporting the main file alone would understate the total.
  const dbBytes = [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].reduce((total, path) => {
    try {
      return total + statSync(path).size;
    } catch {
      return total;
    }
  }, 0);

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM session_events) AS total,
         (SELECT COUNT(*) FROM session_events WHERE type = 'stream_event') AS stream,
         (SELECT COUNT(*) FROM sessions) AS sessions`
    )
    .get() as unknown as { total: number; stream: number; sessions: number };

  return {
    dbBytes,
    totalEvents: counts.total,
    streamEvents: counts.stream,
    compactableEvents: countCompactable(),
    sessions: counts.sessions,
  };
}

function cutoffIso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

/**
 * The highest-seq row of each session is always kept. `appendSessionEvent`
 * derives the next seq from MAX(seq), so removing the last row would let seq
 * numbers repeat on a resumed session.
 */
const COMPACTABLE_PREDICATE = `
  type = 'stream_event'
  AND session_id IN (
    SELECT id FROM sessions
    WHERE status NOT IN (${LIVE_STATUSES.map(() => "?").join(",")})
      AND updated_at < ?
  )
  AND seq < (
    SELECT MAX(seq) FROM session_events inner_e
    WHERE inner_e.session_id = session_events.session_id
  )
`;

function compactArgs(): unknown[] {
  return [...LIVE_STATUSES, cutoffIso(COMPACT_GRACE_MS)];
}

function countCompactable(): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM session_events WHERE ${COMPACTABLE_PREDICATE}`)
    .get(...(compactArgs() as [])) as unknown as { n: number };
  return row.n;
}

export function compactStreamEvents(): number {
  const before = countCompactable();
  if (before === 0) return 0;
  db.prepare(`DELETE FROM session_events WHERE ${COMPACTABLE_PREDICATE}`).run(
    ...(compactArgs() as [])
  );
  return before;
}

/**
 * Drops events for sessions past the retention window. Session rows themselves
 * are kept — they are small, and automations reference their last run by id.
 */
export function pruneOldEvents(): number {
  const days = getSettings().eventRetentionDays;
  if (days <= 0) return 0;

  const cutoff = cutoffIso(days * 24 * 60 * 60 * 1000);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM session_events
       WHERE session_id IN (SELECT id FROM sessions WHERE created_at < ?)`
    )
    .get(cutoff) as unknown as { n: number };

  if (row.n === 0) return 0;
  db.prepare(
    `DELETE FROM session_events
     WHERE session_id IN (SELECT id FROM sessions WHERE created_at < ?)`
  ).run(cutoff);
  return row.n;
}

export interface MaintenanceResult {
  compacted: number;
  pruned: number;
  reclaimedBytes: number;
}

export function runMaintenance(): MaintenanceResult {
  const sizeBefore = getStorageStats().dbBytes;
  const compacted = compactStreamEvents();
  const pruned = pruneOldEvents();

  try {
    // Deleting rows only frees pages inside the file, and under WAL even a
    // VACUUM's writes land in the -wal file. Without a truncating checkpoint the
    // space is never returned to the filesystem, so the log looks compacted
    // while disk usage keeps climbing.
    //
    // The checkpoint runs every pass because the WAL grows on its own; VACUUM is
    // gated because it rewrites the entire file and gets expensive as it grows.
    const freePages = (
      db.prepare("PRAGMA freelist_count").get() as unknown as { freelist_count: number }
    ).freelist_count;

    if (compacted > 0 || pruned > 0 || freePages > 256) {
      db.exec("VACUUM;");
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // Best effort — if another connection blocks it, the rows are still gone and
    // the next hourly pass reclaims the space.
  }

  const sizeAfter = getStorageStats().dbBytes;
  return {
    compacted,
    pruned,
    reclaimedBytes: Math.max(0, sizeBefore - sizeAfter),
  };
}

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

export function startMaintenance(): void {
  const tick = () => {
    try {
      const result = runMaintenance();
      if (result.compacted || result.pruned) {
        console.log(
          `[maintenance] compacted ${result.compacted}, pruned ${result.pruned}, reclaimed ${(result.reclaimedBytes / 1024).toFixed(0)} KB`
        );
      }
    } catch (err) {
      console.error("[maintenance] failed (continuing):", err);
    }
  };
  tick();
  setInterval(tick, MAINTENANCE_INTERVAL_MS).unref?.();
}
