import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Seeds the pre-split `memories` table — inline `UNIQUE` and no owner — with
 * real rows, so importing `db.js` runs the actual table rebuild rather than
 * creating the new shape from scratch.
 */
beforeAll(() => {
  const path = join(mkdtempSync(join(tmpdir(), "jarvis-memsplit-")), "test.db");
  const seed = new DatabaseSync(path);
  seed.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      normalized_content TEXT NOT NULL UNIQUE,
      source_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT
    );
    INSERT INTO memories (id, kind, content, normalized_content, source_session_id, status, created_at, updated_at, last_used_at)
      VALUES
        ('m1','preference','Prefers Tuesday reviews.','prefers tuesday reviews.', NULL, 'active','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
        ('m2','business','Sells to self-directed traders.','sells to self-directed traders.', NULL, 'active','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
        ('m3','fact','An archived note.','an archived note.', NULL, 'archived','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL);
  `);
  seed.close();
  process.env.JARVIS_DB_PATH = path;
});

describe("memory table rebuild", () => {
  it("keeps every memory, including archived ones", async () => {
    const { db } = await import("./db.js");
    const rows = db.prepare("SELECT id, status FROM memories ORDER BY id").all() as unknown as
      Array<{ id: string; status: string }>;
    // The one destructive migration in v2 — losing a row here is unrecoverable.
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
    expect(rows.find((r) => r.id === "m3")?.status).toBe("archived");
  });

  it("assigns existing memories to the default agent rather than sharing them", async () => {
    const { db, DEFAULT_AGENT_ID } = await import("./db.js");
    const rows = db.prepare("SELECT agent_id FROM memories").all() as unknown as
      Array<{ agent_id: string | null }>;
    // Promoting them to shared would broadcast one agent's preferences to every
    // agent created later.
    expect(rows.every((r) => r.agent_id === DEFAULT_AGENT_ID)).toBe(true);
  });

  it("replaces the global unique constraint with a per-agent one", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { remember } = await import("./memoryRepo.js");
    const alice = createAgent({ name: "MemAlice" });
    const bob = createAgent({ name: "MemBob" });

    const a = remember({ kind: "fact", content: "The sky is blue.", agentId: alice.id });
    const b = remember({ kind: "fact", content: "The sky is blue.", agentId: bob.id });

    // Under the old global UNIQUE this was impossible: the second agent would
    // have silently adopted the first agent's row instead of learning its own.
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.memory.id).not.toBe(b.memory.id);
  });

  it("still deduplicates within one agent", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { remember } = await import("./memoryRepo.js");
    const carol = createAgent({ name: "MemCarol" });

    const first = remember({ kind: "fact", content: "Repeat me.", agentId: carol.id });
    const again = remember({ kind: "fact", content: "  repeat   me.  ", agentId: carol.id });
    expect(again.created).toBe(false);
    expect(again.memory.id).toBe(first.memory.id);
  });

  it("deduplicates the shared pool, where NULLs would otherwise all look unique", async () => {
    const { remember } = await import("./memoryRepo.js");
    const first = remember({ kind: "business", content: "Shared company fact.", agentId: null });
    const again = remember({ kind: "business", content: "Shared company fact.", agentId: null });

    // SQLite treats NULLs as distinct in a UNIQUE index, so without the partial
    // index the shared pool accepts unlimited copies of the same fact.
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.memory.id).toBe(first.memory.id);
  });

  it("confirms a shared memory instead of forking a private copy", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { remember } = await import("./memoryRepo.js");
    const dave = createAgent({ name: "MemDave" });
    const shared = remember({ kind: "business", content: "Everyone knows this.", agentId: null });

    const byAgent = remember({ kind: "business", content: "Everyone knows this.", agentId: dave.id });
    expect(byAgent.created).toBe(false);
    expect(byAgent.memory.id).toBe(shared.memory.id);
    expect(byAgent.memory.agentId).toBeNull();
  });

  it("shows an agent its own memories plus the shared pool, never another agent's", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const { remember, listMemories, buildMemoryContext } = await import("./memoryRepo.js");
    const erin = createAgent({ name: "MemErin" });
    const frank = createAgent({ name: "MemFrank" });

    remember({ kind: "fact", content: "Erin private note.", agentId: erin.id });
    remember({ kind: "fact", content: "Frank private note.", agentId: frank.id });
    remember({ kind: "business", content: "Shared to all agents.", agentId: null });

    const visible = listMemories("active", erin.id).map((m) => m.content);
    expect(visible).toContain("Erin private note.");
    expect(visible).toContain("Shared to all agents.");
    expect(visible).not.toContain("Frank private note.");

    const context = buildMemoryContext(40, erin.id);
    expect(context).toContain("Erin private note.");
    expect(context).not.toContain("Frank private note.");
    // Shared entries are labelled, so the model can tell what is common ground.
    expect(context).toContain("shared]");
  });
});
