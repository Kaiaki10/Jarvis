import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-memory-"));
  process.env.JARVIS_DB_PATH = join(directory, "memory.db");
});

describe("durable memory", () => {
  it("deduplicates equivalent facts and revives archived memory", async () => {
    const { remember, updateMemory, listMemories } = await import("./memoryRepo.js");
    const first = remember({ kind: "preference", content: "Launch reviews happen on Tuesday." });
    const duplicate = remember({ kind: "preference", content: "  launch reviews happen on TUESDAY.  " });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.memory.id).toBe(first.memory.id);
    updateMemory(first.memory.id, { status: "archived" });
    expect(listMemories("active")).toHaveLength(0);

    remember({ kind: "preference", content: "Launch reviews happen on Tuesday." });
    expect(listMemories("active")).toHaveLength(1);
  });

  it("injects only active memory as bounded, non-instruction context", async () => {
    const { remember, updateMemory, buildMemoryContext } = await import("./memoryRepo.js");
    const active = remember({ kind: "business", content: "The flagship product is Jarvis." });
    const archived = remember({ kind: "fact", content: "This obsolete fact should stay hidden." });
    updateMemory(archived.memory.id, { status: "archived" });

    const context = buildMemoryContext();
    expect(context).toContain(active.memory.content);
    expect(context).not.toContain(archived.memory.content);
    expect(context).toContain("user-controlled");
  });

  it("records an auditable reflection even when a turn learns nothing new", async () => {
    const { createSession } = await import("./repo.js");
    const { recordMemoryReflection, listMemoryReflections } = await import("./memoryRepo.js");
    const session = createSession({ title: "Memory reflection test", cwd: process.cwd(), permissionMode: "default" });
    recordMemoryReflection({ sessionId: session.id, status: "reviewed", memoriesAdded: 0, memoriesConfirmed: 0 });
    expect(listMemoryReflections(1)[0]).toMatchObject({
      sessionId: session.id,
      sessionTitle: "Memory reflection test",
      status: "reviewed",
      memoriesAdded: 0,
    });
  });
});
