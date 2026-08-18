import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-evolution-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
});

describe("evolution service", () => {
  it("bootstraps the real promotion gap exactly once", async () => {
    const service = await import("./evolutionService.js");
    const repo = await import("../db/repo.js");
    service.ensureEvolutionBootstrap();
    service.ensureEvolutionBootstrap();
    expect(repo.listEvolutionProposals()).toHaveLength(1);
    expect(repo.listEvolutionProposals()[0]).toMatchObject({
      title: "Atomic promotion and rollback engine",
      stage: "observed",
      risk: "high",
    });
  });

  it("defaults sensitive classes to explicit approval", async () => {
    const repo = await import("../db/repo.js");
    const policies = repo.listEvolutionPolicies();
    expect(policies.find((policy) => policy.changeClass === "security")?.autonomy).toBe("approval_required");
    expect(policies.find((policy) => policy.changeClass === "product")?.autonomy).toBe("approval_required");
  });

  it("builds a bounded Lab prompt with evidence requirements", async () => {
    const { labBuildPrompt } = await import("./evolutionService.js");
    const prompt = labBuildPrompt({
      title: "Better campaign reviews",
      problem: "Reviews lack evidence",
      expectedValue: "Safer launches",
      risk: "medium",
      rollbackPlan: "Restore the prior component",
    });
    expect(prompt).toContain("Read AUTOMATION_RULES.md first");
    expect(prompt).toContain("Do exactly one substantive");
    expect(prompt).toContain("remaining risks");
  });
});
