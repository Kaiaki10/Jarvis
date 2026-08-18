import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Seeds a database in its pre-v2 shape — no agents table, identity spread across
 * `settings`, and a session row that predates ownership — so importing `db.js`
 * exercises the real migration rather than a fresh install.
 */
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-agents-"));
  const path = join(dir, "test.db");

  const seed = new DatabaseSync(path);
  seed.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      cwd TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      allowed_tools TEXT,
      task_id TEXT,
      cost_usd REAL,
      turns INTEGER,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO settings (key, value, updated_at) VALUES
      ('business_context', 'Northwest Hussle is a trading community.', '2026-01-01T00:00:00.000Z'),
      ('chat_working_directory', 'C:\\work\\jarvis', '2026-01-01T00:00:00.000Z'),
      ('primary_session_id', 'session-pre-v2', '2026-01-01T00:00:00.000Z');
    INSERT INTO sessions (id, title, status, cwd, permission_mode, created_at, updated_at)
      VALUES ('session-pre-v2', 'Jarvis', 'idle', 'C:\\work\\jarvis', 'default',
              '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  seed.close();

  process.env.JARVIS_DB_PATH = path;
});

describe("v2 migration", () => {
  it("assembles agent one from the settings that used to define Jarvis", async () => {
    const { getDefaultAgent } = await import("./agentRepo.js");
    const jarvis = getDefaultAgent();

    // Identity is carried over, not invented — a fresh-looking agent here would
    // mean the existing business context was silently abandoned.
    expect(jarvis?.name).toBe("Jarvis");
    expect(jarvis?.systemPrompt).toBe("Northwest Hussle is a trading community.");
    expect(jarvis?.cwd).toBe("C:\\work\\jarvis");
    expect(jarvis?.chatSessionId).toBe("session-pre-v2");
    expect(jarvis?.status).toBe("active");
  });

  it("adopts rows that existed before agents did", async () => {
    const { db, DEFAULT_AGENT_ID } = await import("./db.js");
    const row = db
      .prepare("SELECT agent_id FROM sessions WHERE id = 'session-pre-v2'")
      .get() as unknown as { agent_id: string };
    expect(row.agent_id).toBe(DEFAULT_AGENT_ID);
  });

  it("adds agent_id to every root table and to none of the child tables", async () => {
    const { db, AGENT_SCOPED_TABLES } = await import("./db.js");
    const hasAgentId = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).some(
        (column) => column.name === "agent_id"
      );

    for (const table of AGENT_SCOPED_TABLES) expect(hasAgentId(table)).toBe(true);
    // Children reach their agent through a foreign key; a column here would be a
    // second source of truth that can disagree with the parent.
    for (const table of ["deliverables", "content_items", "customer_messages"]) {
      expect(hasAgentId(table)).toBe(false);
    }
    // Deferred to the memory split, which needs a table rebuild.
    expect(hasAgentId("memories")).toBe(false);
  });

  it("does not mint a second Jarvis when it runs again", async () => {
    const { db, DEFAULT_AGENT_ID } = await import("./db.js");
    const { listAgents } = await import("./agentRepo.js");
    const before = listAgents().length;

    // Exactly the statement db.ts runs on every start.
    db.exec(`
      INSERT INTO agents (id, name, role, system_prompt, cwd, avatar, color,
        permission_mode, allowed_tools, chat_session_id, status, created_at, updated_at)
      SELECT '${DEFAULT_AGENT_ID}', 'Jarvis', '', '', '', 'J', 'accent', 'default',
             NULL, NULL, 'active', 'now', 'now'
      WHERE NOT EXISTS (SELECT 1 FROM agents);
    `);

    expect(listAgents().length).toBe(before);
  });
});

describe("agentRepo", () => {
  it("creates an agent and derives an avatar from its name", async () => {
    const { createAgent } = await import("./agentRepo.js");
    const agent = createAgent({ name: "Atlas", role: "Research" });

    expect(agent.name).toBe("Atlas");
    expect(agent.avatar).toBe("A");
    expect(agent.color).toBe("accent");
    expect(agent.status).toBe("active");
    expect(agent.chatSessionId).toBeNull();
  });

  it("keeps an explicit avatar rather than overwriting it", async () => {
    const { createAgent } = await import("./agentRepo.js");
    expect(createAgent({ name: "Scout", avatar: "🛰" }).avatar).toBe("🛰");
  });

  it("round-trips allowedTools through storage", async () => {
    const { createAgent, getAgent, updateAgent } = await import("./agentRepo.js");
    const agent = createAgent({ name: "Tools", allowedTools: ["Read", "Grep"] });
    expect(getAgent(agent.id)?.allowedTools).toEqual(["Read", "Grep"]);

    // null means "no restriction" and must survive as null, not as "[]" — an
    // empty array would silently forbid every tool.
    expect(updateAgent(agent.id, { allowedTools: null })?.allowedTools).toBeNull();
  });

  it("updates only the fields it is given", async () => {
    const { createAgent, updateAgent } = await import("./agentRepo.js");
    const agent = createAgent({ name: "Partial", role: "Original", systemPrompt: "Keep me" });
    const updated = updateAgent(agent.id, { role: "Changed" });

    expect(updated?.role).toBe("Changed");
    expect(updated?.systemPrompt).toBe("Keep me");
    expect(updated?.name).toBe("Partial");
  });

  it("returns undefined rather than throwing for an unknown agent", async () => {
    const { getAgent, updateAgent } = await import("./agentRepo.js");
    expect(getAgent("nope")).toBeUndefined();
    expect(updateAgent("nope", { name: "x" })).toBeUndefined();
  });

  it("archives an agent instead of deleting it", async () => {
    const { createAgent, archiveAgent, getAgent, listAgents } = await import("./agentRepo.js");
    const agent = createAgent({ name: "Retiring" });
    const outcome = archiveAgent(agent.id);

    expect(outcome.ok).toBe(true);
    // The row survives, so its missions and runs stay attributable.
    expect(getAgent(agent.id)?.status).toBe("archived");
    expect(listAgents("active").some((a) => a.id === agent.id)).toBe(false);
  });

  it("refuses to archive the last active agent", async () => {
    const { listAgents, archiveAgent } = await import("./agentRepo.js");
    const active = listAgents("active");
    for (const agent of active.slice(1)) archiveAgent(agent.id);

    const last = listAgents("active");
    expect(last.length).toBe(1);
    const outcome = archiveAgent(last[0].id);
    expect(outcome).toEqual({ ok: false, reason: "last_active_agent" });
  });
});
