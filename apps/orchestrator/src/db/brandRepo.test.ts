import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-brands-"));
  process.env.JARVIS_DB_PATH = join(root, "test.db");
  process.env.JARVIS_KEY_PATH = join(root, "test.key");
  await import("./db.js");
});

const repos = () => import("./brandRepo.js");

describe("brands", () => {
  it("creates, reads, updates, and deletes a brand", async () => {
    const { createBrand, getBrand, updateBrand, deleteBrand, listBrands } = await repos();
    const brand = createBrand({ name: "HussleSol", description: "Solar hustle", website: "https://example.com" });
    expect(brand.logoFile).toBeNull();
    expect(listBrands().map((b) => b.id)).toContain(brand.id);

    const renamed = updateBrand(brand.id, { name: "HussleSol Co", logoFile: "logo.png" })!;
    expect(renamed.name).toBe("HussleSol Co");
    expect(renamed.logoFile).toBe("logo.png");
    expect(getBrand(brand.id)?.description).toBe("Solar hustle");

    deleteBrand(brand.id);
    expect(getBrand(brand.id)).toBeUndefined();
  });
});

describe("visual prompts", () => {
  it("creates drafts that cannot generate until approved", async () => {
    const { createBrand, createVisualPrompt, getVisualPrompt, markPromptGenerating } = await repos();
    const brand = createBrand({ name: "Acme", description: "Widgets" });
    const prompt = createVisualPrompt({ brandId: brand.id, title: "Hero", body: "A sunrise...", kind: "image" });
    expect(prompt.status).toBe("draft");
    // The money gate: no approval, no generating state.
    expect(markPromptGenerating(prompt.id)).toBeUndefined();
    expect(getVisualPrompt(prompt.id)?.status).toBe("draft");
  });

  it("approves, generates, and completes with the result linked", async () => {
    const { createBrand, createVisualPrompt, updateVisualPrompt, markPromptGenerating, finishPromptGeneration } =
      await repos();
    const brand = createBrand({ name: "Beta", description: "Gadgets" });
    const prompt = createVisualPrompt({ brandId: brand.id, title: "Hero", body: "A sunrise...", kind: "image" });
    updateVisualPrompt(prompt.id, { status: "approved" });
    expect(markPromptGenerating(prompt.id)?.status).toBe("generating");
    const done = finishPromptGeneration(prompt.id, true, "hero.png")!;
    expect(done.status).toBe("generated");
    expect(done.resultFile).toBe("hero.png");
  });

  it("returns a failed run to approved so it can be retried without re-review", async () => {
    const { createBrand, createVisualPrompt, updateVisualPrompt, markPromptGenerating, finishPromptGeneration } =
      await repos();
    const brand = createBrand({ name: "Gamma", description: "Gizmos" });
    const prompt = createVisualPrompt({ brandId: brand.id, title: "Hero", body: "A sunrise...", kind: "image" });
    updateVisualPrompt(prompt.id, { status: "approved" });
    markPromptGenerating(prompt.id);
    const retried = finishPromptGeneration(prompt.id, false)!;
    expect(retried.status).toBe("approved");
  });

  it("keeps cascade: deleting a brand removes its prompts", async () => {
    const { createBrand, createVisualPrompt, deleteBrand, getVisualPrompt, listVisualPrompts } = await repos();
    const brand = createBrand({ name: "Delta", description: "Things" });
    const prompt = createVisualPrompt({ brandId: brand.id, title: "Hero", body: "A sunrise...", kind: "image" });
    deleteBrand(brand.id);
    expect(getVisualPrompt(prompt.id)).toBeUndefined();
    expect(listVisualPrompts(brand.id)).toHaveLength(0);
  });
});

describe("self-improvement signal", () => {
  it("returns only kept prompts as exemplars, newest first", async () => {
    const { createBrand, createVisualPrompt, updateVisualPrompt, listKeptPrompts } = await repos();
    const brand = createBrand({ name: "Epsilon", description: "Stuff" });
    const good = createVisualPrompt({ brandId: brand.id, title: "Good", body: "Warm light...", kind: "image" });
    const bad = createVisualPrompt({ brandId: brand.id, title: "Bad", body: "Cold light...", kind: "image" });
    const meh = createVisualPrompt({ brandId: brand.id, title: "Meh", body: "Plain...", kind: "image" });
    updateVisualPrompt(good.id, { rating: "keep" });
    updateVisualPrompt(bad.id, { rating: "needs_work" });
    const kept = listKeptPrompts(brand.id);
    expect(kept.map((p) => p.id)).toEqual([good.id]);
    expect(kept[0].rating).toBe("keep");
    expect(meh.rating).toBeNull();
  });

  it("tracks iteration chains through parent links", async () => {
    const { createBrand, createVisualPrompt, getVisualPrompt } = await repos();
    const brand = createBrand({ name: "Zeta", description: "Stuff" });
    const parent = createVisualPrompt({ brandId: brand.id, title: "V1", body: "A sunrise...", kind: "image" });
    const child = createVisualPrompt({ brandId: brand.id, title: "V2", body: "A brighter sunrise...", kind: "image", parentId: parent.id });
    expect(getVisualPrompt(child.id)?.parentId).toBe(parent.id);
  });
});

describe("brand campaigns", () => {
  it("links campaigns to a brand and lists them", async () => {
    const { createBrand } = await repos();
    const workflows = await import("./workflowRepo.js");
    const brand = createBrand({ name: "Linked", description: "Stuff" });
    const owned = workflows.createWorkflow({
      name: "Launch",
      objective: "Go",
      audience: "All",
      offer: "Thing",
      channels: ["x"],
      primaryMetric: "Reads",
      approvalPolicy: "each_item",
      brandId: brand.id,
    });
    const stray = workflows.createWorkflow({
      name: "Other",
      objective: "Go",
      audience: "All",
      offer: "Thing",
      channels: ["x"],
      primaryMetric: "Reads",
      approvalPolicy: "each_item",
    });
    expect(owned.brandId).toBe(brand.id);
    expect(workflows.listWorkflowsByBrand(brand.id).map((w) => w.id)).toEqual([owned.id]);
    expect(stray.brandId).toBeNull();
    const unlinked = workflows.updateWorkflow(owned.id, { brandId: null })!;
    expect(unlinked.brandId).toBeNull();
    expect(workflows.listWorkflowsByBrand(brand.id)).toHaveLength(0);
  });

  it("round-trips an attached visual on content items", async () => {
    const { createBrand } = await repos();
    const workflows = await import("./workflowRepo.js");
    const brand = createBrand({ name: "Visual", description: "Stuff" });
    const campaign = workflows.createWorkflow({
      name: "Launch",
      objective: "Go",
      audience: "All",
      offer: "Thing",
      channels: ["x"],
      primaryMetric: "Reads",
      approvalPolicy: "each_item",
      brandId: brand.id,
    });
    const item = workflows.createContentItem({
      workflowId: campaign.id,
      title: "Hero post",
      body: "Hello.",
      format: "social_post",
      channel: "x",
      imageFile: "hero.png",
    });
    expect(item.imageFile).toBe("hero.png");
    const cleared = workflows.updateContentItem(item.id, { imageFile: null })!;
    expect(cleared.imageFile).toBeNull();
  });
});

describe("visual prompt runs", () => {
  it("tracks a scripts run to completion and recovers interrupted runs", async () => {
    const {
      createBrand,
      createVisualPrompt,
      createVisualPromptRun,
      getVisualPromptRunBySession,
      finishVisualPromptRun,
      updateVisualPrompt,
      markPromptGenerating,
      getVisualPrompt,
      recoverInterruptedVisualPromptRuns,
    } = await repos();
    const { createSession } = await import("./repo.js");
    const brand = createBrand({ name: "Eta", description: "Stuff" });
    const session = createSession({ title: "t", cwd: process.cwd(), permissionMode: "default" });
    const run = createVisualPromptRun({ kind: "scripts", brandId: brand.id, sessionId: session.id, requestedCount: 4 });
    expect(run.status).toBe("running");
    finishVisualPromptRun(session.id, "completed");
    expect(getVisualPromptRunBySession(session.id)?.status).toBe("completed");

    const prompt = createVisualPrompt({ brandId: brand.id, title: "Stuck", body: "Hmm...", kind: "image" });
    updateVisualPrompt(prompt.id, { status: "approved" });
    markPromptGenerating(prompt.id);
    recoverInterruptedVisualPromptRuns();
    expect(getVisualPrompt(prompt.id)?.status).toBe("approved");
  });
});
