import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-missions-"));
  process.env.JARVIS_DB_PATH = join(dir, "test.db");
});

describe("mission run reconciliation", () => {
  it("extracts reviewable next actions and blockers", async () => {
    const { extractMissionSignals } = await import("./missionReconciler.js");
    const signals = extractMissionSignals(`Completed the onboarding audit.\n\nNext action: Ask legal to approve the revised disclosure.\nBlocker: Waiting for the retention policy.`);
    expect(signals.summary).toBe("Completed the onboarding audit.");
    expect(signals.nextAction).toBe("Ask legal to approve the revised disclosure.");
    expect(signals.blocker).toBe("Waiting for the retention policy.");
  });

  it("captures deliverable files without treating source edits as artifacts", async () => {
    const { collectArtifactsFromMessage } = await import("./missionReconciler.js");
    const cwd = "C:\\work";
    expect(collectArtifactsFromMessage({
      type: "assistant",
      message: { content: [
        { type: "tool_use", name: "Write", input: { file_path: "reports/readiness.pdf" } },
        { type: "tool_use", name: "Edit", input: { file_path: "src/app.ts" } },
      ] },
    }, cwd)).toEqual(["C:\\work\\reports\\readiness.pdf"]);
  });

  it("completes the linked step and creates a proposed mission update", async () => {
    const repo = await import("../db/repo.js");
    const { reconcileMissionTurn } = await import("./missionReconciler.js");
    const mission = repo.createMission({ title: "Client portal", outcome: "Clients can onboard" });
    const task = repo.createTask({ title: "Run readiness audit", missionId: mission.id });
    const session = repo.createSession({ title: "Readiness audit", cwd: "C:\\work", permissionMode: "default", taskId: task.id });

    const artifactDir = mkdtempSync(join(tmpdir(), "jarvis-artifacts-"));
    const artifact = join(artifactDir, "launch.pdf");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(artifact, "report");
    reconcileMissionTurn({
      sessionId: session.id,
      ok: true,
      result: "Audit completed.\nNext action: Review the launch report.",
      artifactPaths: [artifact],
    });

    expect(repo.getTask(task.id)?.status).toBe("done");
    expect(repo.getMission(mission.id)?.status).toBe("active");
    expect(repo.listDeliverables(mission.id)).toHaveLength(1);
    expect(repo.listMissionUpdates(mission.id)[0]).toMatchObject({
      status: "proposed",
      proposedNextAction: "Review the launch report.",
      artifactCount: 1,
    });
  });
});
