import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-visual-prompts-"));
  process.env.JARVIS_DB_PATH = join(root, "test.db");
  process.env.JARVIS_KEY_PATH = join(root, "test.key");
  await import("../db/db.js");
});

describe("parseVisualPrompts", () => {
  it("parses the tagged block and rejects malformed output", async () => {
    const { parseVisualPrompts } = await import("./visualPrompts.js");
    const drafts = parseVisualPrompts({
      result: `<jarvis-visual-prompts>
{"prompts":[{"title":"Hero","body":"A sunrise over panels.","kind":"image","model":null}]}
</jarvis-visual-prompts>`,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ title: "Hero", kind: "image" });
    expect(() => parseVisualPrompts({ result: "no json here" })).toThrow();
    expect(() => parseVisualPrompts({ result: "" })).toThrow();
  });
});

describe("visualPromptGenerationPrompt", () => {
  it("embeds kept prompts as the style signal and recent outputs as continuity", async () => {
    const { createBrand, createVisualPrompt, updateVisualPrompt } = await import("../db/brandRepo.js");
    const { visualPromptGenerationPrompt } = await import("./visualPrompts.js");
    const brand = createBrand({ name: "Sol", description: "Rooftop solar for renters" });
    const kept = createVisualPrompt({ brandId: brand.id, title: "Golden roof", body: "Warm golden-hour light on panels.", kind: "image" });
    updateVisualPrompt(kept.id, { rating: "keep" });
    const prompt = visualPromptGenerationPrompt({ brand: { ...brand, description: brand.description }, count: 4, kinds: ["image"] });
    expect(prompt).toContain("Warm golden-hour light");
    expect(prompt).toContain("Rooftop solar for renters");
  });

  it("falls back to a foundation brief when nothing is kept yet", async () => {
    const { createBrand } = await import("../db/brandRepo.js");
    const { visualPromptGenerationPrompt } = await import("./visualPrompts.js");
    const brand = createBrand({ name: "Fresh", description: "New thing" });
    const prompt = visualPromptGenerationPrompt({ brand, count: 2, kinds: ["video"] });
    expect(prompt).toContain("visual foundation");
  });
});

describe("reconcileVisualPromptScripts", () => {
  it("turns a scripts run into draft prompts and ignores other sessions", async () => {
    const { createBrand, createVisualPromptRun, listVisualPrompts } = await import("../db/brandRepo.js");
    const { createSession } = await import("../db/repo.js");
    const { reconcileVisualPromptScripts } = await import("./visualPrompts.js");
    const brand = createBrand({ name: "Recon", description: "Things" });
    const session = createSession({ title: "t", cwd: process.cwd(), permissionMode: "default" });
    createVisualPromptRun({ kind: "scripts", brandId: brand.id, sessionId: session.id, requestedCount: 1 });

    expect(reconcileVisualPromptScripts({ sessionId: "unknown", result: null, ok: true })).toBe(false);
    const handled = reconcileVisualPromptScripts({
      sessionId: session.id,
      result: `<jarvis-visual-prompts>{"prompts":[{"title":"T1","body":"B1","kind":"image","model":null}]}</jarvis-visual-prompts>`,
      ok: true,
    });
    expect(handled).toBe(true);
    const prompts = listVisualPrompts(brand.id);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].status).toBe("draft");
  });

  it("records failure without creating prompts", async () => {
    const { createBrand, createVisualPromptRun, getVisualPromptRunBySession, listVisualPrompts } =
      await import("../db/brandRepo.js");
    const { createSession } = await import("../db/repo.js");
    const { reconcileVisualPromptScripts } = await import("./visualPrompts.js");
    const brand = createBrand({ name: "ReconFail", description: "Things" });
    const session = createSession({ title: "t", cwd: process.cwd(), permissionMode: "default" });
    createVisualPromptRun({ kind: "scripts", brandId: brand.id, sessionId: session.id, requestedCount: 1 });
    expect(reconcileVisualPromptScripts({ sessionId: session.id, result: null, ok: false })).toBe(true);
    expect(getVisualPromptRunBySession(session.id)?.status).toBe("failed");
    expect(listVisualPrompts(brand.id)).toHaveLength(0);
  });
});

describe("reconcileVisualPromptExecution", () => {
  it("completes the prompt on success and returns it to approved on failure", async () => {
    const { createBrand, createVisualPrompt, updateVisualPrompt, createVisualPromptRun, getVisualPrompt } =
      await import("../db/brandRepo.js");
    const { createSession } = await import("../db/repo.js");
    const { beginPromptExecution, reconcileVisualPromptExecution } = await import("./visualPrompts.js");
    const brand = createBrand({ name: "Exec", description: "Things" });
    const okSession = createSession({ title: "t", cwd: process.cwd(), permissionMode: "default" });
    const okPrompt = createVisualPrompt({ brandId: brand.id, title: "Ok", body: "B", kind: "image" });
    updateVisualPrompt(okPrompt.id, { status: "approved" });
    beginPromptExecution(okPrompt.id);
    createVisualPromptRun({ kind: "execute", brandId: brand.id, visualPromptId: okPrompt.id, sessionId: okSession.id, requestedCount: 1 });
    expect(reconcileVisualPromptExecution({ sessionId: okSession.id, ok: true })).toBe(true);
    expect(getVisualPrompt(okPrompt.id)?.status).toBe("generated");

    const failSession = createSession({ title: "t", cwd: process.cwd(), permissionMode: "default" });
    const failPrompt = createVisualPrompt({ brandId: brand.id, title: "Fail", body: "B", kind: "image" });
    updateVisualPrompt(failPrompt.id, { status: "approved" });
    beginPromptExecution(failPrompt.id);
    createVisualPromptRun({ kind: "execute", brandId: brand.id, visualPromptId: failPrompt.id, sessionId: failSession.id, requestedCount: 1 });
    expect(reconcileVisualPromptExecution({ sessionId: failSession.id, ok: false })).toBe(true);
    expect(getVisualPrompt(failPrompt.id)?.status).toBe("approved");
  });

  it("refuses to begin execution for anything but approved prompts", async () => {
    const { createBrand, createVisualPrompt } = await import("../db/brandRepo.js");
    const { beginPromptExecution } = await import("./visualPrompts.js");
    const brand = createBrand({ name: "Gate", description: "Things" });
    const draft = createVisualPrompt({ brandId: brand.id, title: "Draft", body: "B", kind: "image" });
    expect(beginPromptExecution(draft.id)).toBeUndefined();
    expect(beginPromptExecution("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });
});
