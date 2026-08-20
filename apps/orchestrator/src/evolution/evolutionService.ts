import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { EvolutionReadiness } from "@jarvis/shared";
import { createEvolutionProposal, listEvolutionProposals } from "../db/repo.js";

// process.cwd() in production is apps/orchestrator (restart-service.ps1 runs
// npm --prefix'd from there). The lab worktree is a sibling of the whole repo
// folder per CLAUDE.md ("a git worktree at ../jarvis-lab", relative to the
// repo root) — apps/orchestrator -> apps -> jarvis (repo root) -> its parent,
// three levels, not one. The one-level version resolved to apps/jarvis-lab,
// which never exists; evolutionReadiness().labAvailable had likely been
// silently false in production this whole time as a result, independent of
// the scheduler's own automations, which store their own absolute cwd per
// task and never went through this constant.
export const LAB_PATH = process.env.JARVIS_LAB_PATH ?? resolve(process.cwd(), "..", "..", "..", "jarvis-lab");

// The launcher, not promote-lab.ps1 directly, is what the server actually
// spawns (see http/server.ts) — checking the wrong one here would report
// ready while every real promotion 503s.
const PROMOTE_LAUNCHER_PATH = resolve(process.cwd(), "..", "..", "scripts", "promote-lab-launcher.ps1");

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
    // A green badge must be evidence, not code that merely exists.
    // promotionEngineReady flips true once the promotion launcher exists —
    // it merges, rebuilds, restarts, and verifies with a real session.
    // automaticRollbackReady flipped true only after that rollback path was
    // actually exercised for real: a genuinely failed promotion (a forced
    // verification failure) that recovered on its own — reset the merge,
    // restored the pre-promotion database and build snapshot, restarted, and
    // came back healthy, verified live on 2026-08-20, not just read and
    // trusted. See GAPS.md.
    promotionEngineReady: existsSync(PROMOTE_LAUNCHER_PATH),
    automaticRollbackReady: true,
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
