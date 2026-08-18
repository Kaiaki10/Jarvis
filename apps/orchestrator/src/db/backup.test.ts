import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "jarvis-backup-"));
  process.env.JARVIS_DB_PATH = join(directory, "source.db");
});

describe("createDatabaseBackup", () => {
  it("copies committed Jarvis state into a readable SQLite snapshot", async () => {
    const { db } = await import("./db.js");
    const { createDatabaseBackup } = await import("./backup.js");
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("backup_probe", "present", new Date().toISOString());

    const destination = join(directory, "snapshot.db");
    await createDatabaseBackup(destination);
    expect(existsSync(destination)).toBe(true);

    const snapshot = new DatabaseSync(destination, { readOnly: true });
    const row = snapshot.prepare("SELECT value FROM settings WHERE key = ?").get(
      "backup_probe"
    ) as unknown as { value: string };
    snapshot.close();
    expect(row.value).toBe("present");
  });
});
