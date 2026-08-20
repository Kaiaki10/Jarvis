/**
 * Records the outcome of a promotion attempt against its evolution proposal
 * row. Run as a standalone CLI from `scripts/promote-lab.ps1`, which does the
 * actual merge/build/restart/rollback outside this (or any) Node process's
 * lifetime — the orchestrator that started a promotion is not necessarily the
 * one still running by the time an outcome is known, so this is invoked as a
 * fresh, short-lived process against the same on-disk database rather than
 * called as a function from within a request handler.
 *
 * Usage: node recordPromotionOutcome.js <proposalId> <promoted|rolled_back> <detail>
 */
import { updateEvolutionProposal, getEvolutionProposal } from "../db/repo.js";

const [, , proposalId, stage, ...detailParts] = process.argv;
const detail = detailParts.join(" ");

if (!proposalId || (stage !== "promoted" && stage !== "rolled_back")) {
  console.error("usage: recordPromotionOutcome <proposalId> <promoted|rolled_back> <detail>");
  process.exit(1);
}

if (!getEvolutionProposal(proposalId)) {
  console.error(`No such evolution proposal: ${proposalId}`);
  process.exit(1);
}

updateEvolutionProposal(proposalId, { stage, evidence: detail || null });
console.log(`Recorded ${stage} for proposal ${proposalId}.`);
