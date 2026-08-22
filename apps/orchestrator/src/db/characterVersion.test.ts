import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.js";
import { getCharacter, listCharacterVersions, saveCharacter } from "./characterRepo.js";
import { createWorkflow } from "./workflowRepo.js";

function workflow() {
  return createWorkflow({
    name: "W", objective: "o", audience: "a", offer: "f",
    channels: ["x"], primaryMetric: "m", approvalPolicy: "each_item",
  });
}

const base = (workflowId: string) => ({
  workflowId,
  name: "Cass",
  persona: "Builds in public.",
  voiceRules: "Short sentences.",
  exemplars: ["A sample."],
  disclosure: "AI-generated.",
});

describe("character versioning", () => {
  beforeEach(() => {
    db.exec("DELETE FROM workflow_character_versions");
    db.exec("DELETE FROM workflow_characters");
  });

  it("starts at version 1", () => {
    const w = workflow();
    expect(saveCharacter(base(w.id)).version).toBe(1);
  });

  it("does not bump when nothing changed", () => {
    const w = workflow();
    saveCharacter(base(w.id));
    expect(saveCharacter(base(w.id)).version).toBe(1);
  });

  it("bumps when the voice rules change", () => {
    const w = workflow();
    saveCharacter(base(w.id));
    expect(saveCharacter({ ...base(w.id), voiceRules: "Long sentences." }).version).toBe(2);
  });

  it("bumps when an exemplar changes — the field that most shapes the voice", () => {
    const w = workflow();
    saveCharacter(base(w.id));
    expect(saveCharacter({ ...base(w.id), exemplars: ["Different sample."] }).version).toBe(2);
  });

  it("bumps when the disclosure changes, since that appears in every post", () => {
    const w = workflow();
    saveCharacter(base(w.id));
    expect(saveCharacter({ ...base(w.id), disclosure: "Written by an AI." }).version).toBe(2);
  });

  it("does NOT bump for appearance, which steers images rather than writing", () => {
    const w = workflow();
    saveCharacter(base(w.id));
    // Bumping here would invalidate the attribution of text written earlier.
    expect(saveCharacter({ ...base(w.id), appearance: "Wears a red coat." }).version).toBe(1);
  });

  it("keeps every past version, so an old one is recoverable", () => {
    const w = workflow();
    saveCharacter(base(w.id));
    saveCharacter({ ...base(w.id), voiceRules: "v2 rules" });
    saveCharacter({ ...base(w.id), voiceRules: "v3 rules" });

    expect(getCharacter(w.id)?.version).toBe(3);
    expect(listCharacterVersions(w.id).map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("snapshots the old sheet, not the new one, under the old number", () => {
    const w = workflow();
    saveCharacter(base(w.id));
    saveCharacter({ ...base(w.id), voiceRules: "changed" });

    const v1 = db
      .prepare(`SELECT voice_rules FROM workflow_character_versions WHERE workflow_id = ? AND version = 1`)
      .get(w.id) as unknown as { voice_rules: string };
    expect(v1.voice_rules).toBe("Short sentences.");
  });

  it("records v1 even for a character that never changes", () => {
    const w = workflow();
    saveCharacter(base(w.id));
    expect(listCharacterVersions(w.id)).toHaveLength(1);
  });
});
