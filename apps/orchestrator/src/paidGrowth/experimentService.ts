import type {
  CampaignExperimentRecord,
  CampaignExperimentView,
  CampaignExperimentsOverview,
  CreateCampaignExperimentRequest,
  PaidGrowthCampaignView,
  PaidGrowthDecisionRecord,
} from "@jarvis/shared";
import { getConnection } from "../db/connectionsRepo.js";
import {
  concludeCampaignExperiment,
  createCampaignExperiment as insertCampaignExperiment,
  getCampaignExperiment,
  hasRunningExperimentForCampaign,
  listCampaignExperiments,
  listExperimentVariantCampaignIds,
} from "../db/campaignExperimentsRepo.js";
import { createPaidGrowthDecision, getPaidGrowthCampaign } from "../db/paidGrowthRepo.js";
import { paidGrowthMetrics } from "./engine.js";
import { evaluateExperiment } from "./experimentEngine.js";

function toView(campaign: NonNullable<ReturnType<typeof getPaidGrowthCampaign>>): PaidGrowthCampaignView {
  return {
    ...campaign,
    metrics: paidGrowthMetrics(campaign),
    connectionReady: getConnection(campaign.platform)?.status === "connected",
  };
}

function variantCampaigns(experimentId: string, agentId?: string): PaidGrowthCampaignView[] {
  return listExperimentVariantCampaignIds(experimentId)
    .map((id) => getPaidGrowthCampaign(id, agentId))
    .filter((campaign): campaign is NonNullable<typeof campaign> => Boolean(campaign))
    .map(toView);
}

export function createExperiment(input: CreateCampaignExperimentRequest, agentId?: string): CampaignExperimentRecord {
  const uniqueIds = Array.from(new Set(input.variantPaidCampaignIds));
  if (uniqueIds.length < 2) throw new Error("An experiment needs at least two distinct paid campaigns");
  const campaigns = uniqueIds.map((id) => {
    const campaign = getPaidGrowthCampaign(id, agentId);
    if (!campaign) throw new Error(`Paid campaign ${id} not found`);
    return campaign;
  });
  for (const campaign of campaigns) {
    if (hasRunningExperimentForCampaign(campaign.id)) {
      throw new Error(`${campaign.name} is already part of a running experiment`);
    }
  }
  if (input.controlPaidCampaignId && !uniqueIds.includes(input.controlPaidCampaignId)) {
    throw new Error("The control campaign must be one of the variant campaigns");
  }
  return insertCampaignExperiment({
    name: input.name,
    hypothesis: input.hypothesis,
    variantPaidCampaignIds: uniqueIds,
    controlPaidCampaignId: input.controlPaidCampaignId ?? null,
    minConversionsPerVariant: input.minConversionsPerVariant,
    minDaysRunning: input.minDaysRunning,
  });
}

function toExperimentView(experiment: CampaignExperimentRecord, agentId?: string): CampaignExperimentView {
  const variants = variantCampaigns(experiment.id, agentId);
  const eligibility =
    experiment.status === "running"
      ? (() => {
          const conclusion = evaluateExperiment(experiment, variants);
          return { ready: conclusion.ready, reason: conclusion.reason };
        })()
      : null;
  return { ...experiment, variants, eligibility };
}

export function campaignExperimentsOverview(agentId?: string): CampaignExperimentsOverview {
  return { experiments: listCampaignExperiments(agentId).map((experiment) => toExperimentView(experiment, agentId)) };
}

export function concludeExperiment(id: string, agentId?: string): { experiment: CampaignExperimentRecord; decision: PaidGrowthDecisionRecord | null } {
  const experiment = getCampaignExperiment(id, agentId);
  if (!experiment) throw new Error("Campaign experiment not found");
  if (experiment.status !== "running") throw new Error("This experiment has already been concluded");
  const variants = variantCampaigns(id, agentId);
  const conclusion = evaluateExperiment(experiment, variants);
  if (!conclusion.ready) throw new Error(conclusion.reason);

  let decision: PaidGrowthDecisionRecord | null = null;
  if (conclusion.winnerPaidCampaignId && conclusion.proposedDailyBudgetMinor !== null) {
    decision = createPaidGrowthDecision({
      paidCampaignId: conclusion.winnerPaidCampaignId,
      kind: "reallocate",
      reason: conclusion.reason,
      proposedDailyBudgetMinor: conclusion.proposedDailyBudgetMinor,
      sourcePaidCampaignId: conclusion.loserPaidCampaignId,
      experimentId: id,
    });
  }

  const updated = concludeCampaignExperiment(id, {
    status: "concluded",
    winnerPaidCampaignId: conclusion.winnerPaidCampaignId,
    conclusionNote: conclusion.reason,
  })!;
  return { experiment: updated, decision };
}

export function abandonExperiment(id: string, reason: string, agentId?: string): CampaignExperimentRecord {
  const experiment = getCampaignExperiment(id, agentId);
  if (!experiment) throw new Error("Campaign experiment not found");
  if (experiment.status !== "running") throw new Error("This experiment has already been concluded");
  return concludeCampaignExperiment(id, { status: "abandoned", winnerPaidCampaignId: null, conclusionNote: reason })!;
}
