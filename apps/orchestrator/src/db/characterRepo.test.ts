import { describe, expect, it } from "vitest";
import { characterBrief, getCharacter, saveCharacter } from "./characterRepo.js";
import { createWorkflow } from "./workflowRepo.js";
import { db } from "./db.js";

function workflow() {
  return createWorkflow({
    name: "W", objective: "o", audience: "a", offer: "f",
    channels: ["x"], primaryMetric: "m", approvalPolicy: "each_item",
  });
}

describe("workflow characters", () => {
  it("round-trips a sheet including its exemplars", () => {
    const w = workflow();
    saveCharacter({
      workflowId: w.id,
      name: "Cass",
      persona: "An engineer who builds in public.",
      voiceRules: "Short sentences. No hype.",
      exemplars: ["Shipped the migration. It broke twice first.", "Second sample."],
      disclosure: "Cass is an AI character.",
    });

    const c = getCharacter(w.id)!;
    expect(c.name).toBe("Cass");
    expect(c.exemplars).toHaveLength(2);
    expect(c.exemplars[0]).toMatch(/Shipped the migration/);
  });

  it("updates in place rather than creating a second character", () => {
    const w = workflow();
    saveCharacter({ workflowId: w.id, name: "First", disclosure: "d" });
    saveCharacter({ workflowId: w.id, name: "Second", disclosure: "d" });
    expect(getCharacter(w.id)?.name).toBe("Second");
  });

  it("keeps fields that a partial save omits", () => {
    const w = workflow();
    saveCharacter({ workflowId: w.id, name: "Cass", voiceRules: "No hype.", disclosure: "d" });
    saveCharacter({ workflowId: w.id, name: "Cass", disclosure: "d" });
    expect(getCharacter(w.id)?.voiceRules).toBe("No hype.");
  });

  it("contributes nothing to a prompt when there is no character", () => {
    expect(characterBrief(undefined)).toBe("");
  });

  it("labels exemplars as voice samples, not subject matter to reuse", () => {
    const w = workflow();
    const c = saveCharacter({
      workflowId: w.id,
      name: "Cass",
      exemplars: ["A sample post."],
      disclosure: "Cass is an AI character.",
    });
    const brief = characterBrief(c);

    expect(brief).toMatch(/writing as Cass/);
    expect(brief).toMatch(/Do not reuse their subject matter/);
    expect(brief).toMatch(/do not rewrite them/);
    expect(brief).toContain("A sample post.");
  });

  it("always carries the disclosure and forbids implying humanity", () => {
    const w = workflow();
    const c = saveCharacter({
      workflowId: w.id,
      name: "Cass",
      disclosure: "Cass is an AI character run by Jarvis.",
    });
    const brief = characterBrief(c);

    expect(brief).toContain("Cass is an AI character run by Jarvis.");
    expect(brief).toMatch(/Never write anything that implies Cass is a human being/);
  });

  it("survives corrupted exemplar JSON rather than failing the run", () => {
    const w = workflow();
    saveCharacter({ workflowId: w.id, name: "Cass", disclosure: "d" });
    db.prepare(`UPDATE workflow_characters SET exemplars = 'not json' WHERE workflow_id = ?`).run(w.id);
    expect(getCharacter(w.id)?.exemplars).toEqual([]);
  });
});
