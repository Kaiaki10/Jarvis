import { backup } from "node:sqlite";
import { db } from "./db.js";

/** Creates a transactionally consistent online snapshot of the live database. */
export function createDatabaseBackup(path: string): Promise<number> {
  return backup(db, path);
}
