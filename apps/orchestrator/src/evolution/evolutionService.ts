import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { EvolutionReadiness } from "@jarvis/shared";
import { createEvolutionProposal, listEvolutionProposals } from "../db/repo.js";

export const LAB_PATH = process.env.JARVIS_LAB_PATH ?? resolve(process.cwd(), "..", "jarvis-lab");

function labBranch(): string | null {
  if (!existsSync(LAB_PATH)) return null;
  const result = spawnSync("git", ["-C", LAB_PATH, "branch", "--show-current"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

export function evolutionReadiness(): EvolutionReadiness {
  return {
    labAvailable: existsSync(LAB_PATH),
    labPath: LAB_PATH,
    labBranch: labBranch(),
    // The center deliberately reports these as false until promotion is atomic
    // and health-triggered rollback is implemented. A green badge must be evidence.
    promotionEngineReady: false,
    automaticRollbackReady: false,
  };
}

export function ensureEvolutionBootstrap(): void {
  if (listEvolutionProposals().length > 0) return;
  createEvolutionProposal({
    title: "Atomic promotion and rollback engine",
    problem: "Jarvis Lab can build and commit improvements, but production promotion still requires a manual merge, rebuild, and restart.",
    expectedValue: "Verified low-risk improvements can reach production safely, with health checks and an automatic return to the last known-good version.",
    changeClass: "product",
    risk: "high",
    evidence: "The isolated jarvis-lab worktree and automated verification already exist; the missing boundary is safe promotion.",
    rollbackPlan: "Retain the current build and database snapshot, switch versions atomically, and restore both if post-deploy health checks fail.",
  });
}

export function labBuildPrompt(proposal: {
  title: string;
  problem: string;
  expectedValue: string;
  risk: string;
  rollbackPlan: string | null;
}): string {
  return `Read AUTOMATION_RULES.md first and follow it exactly.\n\nEvolution proposal: ${proposal.title}\n\nProblem:\n${proposal.problem}\n\nExpected user value:\n${proposal.expectedValue}\n\nRisk: ${proposal.risk}\n\nRollback plan:\n${proposal.rollbackPlan || "Document a concrete rollback plan before changing code."}\n\nDo exactly one substantive, reviewable improvement for this proposal in Jarvis Lab. Run every required verification check and commit only if the result is green. In your final response, state what changed, the evidence, remaining risks, and how to roll it back.`;
}
