import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-db-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
});

describe("database initialization", () => {
  it("enforces foreign keys and applies explicit schema upgrades", async () => {
    const { db } = await import("./db.js");
    const foreignKeys = db.prepare("PRAGMA foreign_keys").get() as unknown as {
      foreign_keys: number;
    };
    const columns = db.prepare("PRAGMA table_info(scheduled_tasks)").all() as unknown as Array<{
      name: string;
    }>;
    const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as unknown as Array<{
      name: string;
    }>;
    const paidGrowthColumns = db.prepare("PRAGMA table_info(paid_growth_campaigns)").all() as unknown as Array<{
      name: string;
    }>;

    expect(foreignKeys.foreign_keys).toBe(1);
    expect(columns.some((column) => column.name === "retry_count")).toBe(true);
    expect(taskColumns.some((column) => column.name === "mission_id")).toBe(true);
    expect(paidGrowthColumns.some((column) => column.name === "external_budget_entity_id")).toBe(true);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'missions'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deliverables'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_items'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_publication_runs'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'paid_growth_campaigns'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'paid_growth_decisions'").get()).toBeTruthy();
  });
});
