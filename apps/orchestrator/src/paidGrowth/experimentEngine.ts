import type { CampaignExperimentRecord, PaidGrowthCampaignRecord } from "@jarvis/shared";
import { paidGrowthMetrics } from "./engine.js";

export interface ExperimentConclusion {
  ready: boolean;
  reason: string;
  winnerPaidCampaignId: string | null;
  loserPaidCampaignId: string | null;
  proposedDailyBudgetMinor: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pure evaluation of one experiment against its variants' current cumulative
 * totals. No side effects, no DB access -- mirrors engine.ts's style so it can
 * be called both from a live overview (read-only) and from `concludeExperiment`
 * (the only place its result is acted on).
 */
export function evaluateExperiment(
  experiment: CampaignExperimentRecord,
  variantCampaigns: PaidGrowthCampaignRecord[],
  now: number = Date.now()
): ExperimentConclusion {
  const notReady = (reason: string): ExperimentConclusion => ({
    ready: false,
    reason,
    winnerPaidCampaignId: null,
    loserPaidCampaignId: null,
    proposedDailyBudgetMinor: null,
  });

  const daysRunning = (now - new Date(experiment.startedAt).getTime()) / MS_PER_DAY;
  if (daysRunning < experiment.minDaysRunning) {
    return notReady(`Running ${Math.max(0, Math.floor(daysRunning))}/${experiment.minDaysRunning} days.`);
  }

  const short = variantCampaigns.filter((campaign) => campaign.conversions < experiment.minConversionsPerVariant);
  if (short.length > 0) {
    const worst = short.reduce((min, campaign) => Math.min(min, campaign.conversions), Infinity);
    return notReady(`${short.length} of ${variantCampaigns.length} variants have not reached ${experiment.minConversionsPerVariant} conversions (lowest: ${worst}).`);
  }

  const ranked = variantCampaigns
    .map((campaign) => ({ campaign, roas: paidGrowthMetrics(campaign).roas }))
    .filter((entry): entry is { campaign: PaidGrowthCampaignRecord; roas: number } => entry.roas !== null)
    .sort((a, b) => b.roas - a.roas);
  const best = ranked[0];
  const worst = ranked.at(-1);

  if (!best || !worst || best.campaign.id === worst.campaign.id) {
    return {
      ready: true,
      reason: "Every variant has reached the threshold, but there is not enough distinct performance data to declare a winner.",
      winnerPaidCampaignId: null,
      loserPaidCampaignId: null,
      proposedDailyBudgetMinor: null,
    };
  }

  if (best.roas < worst.roas * 1.5) {
    return {
      ready: true,
      reason: `Thresholds are met, but ${best.campaign.name}'s ${best.roas.toFixed(2)}× ROAS is not decisively ahead of ${worst.campaign.name}'s ${worst.roas.toFixed(2)}× — no winner declared.`,
      winnerPaidCampaignId: null,
      loserPaidCampaignId: null,
      proposedDailyBudgetMinor: null,
    };
  }

  return {
    ready: true,
    reason: `${best.campaign.name} is producing ${best.roas.toFixed(2)}× ROAS versus ${worst.roas.toFixed(2)}× for ${worst.campaign.name}, both past the experiment's thresholds.`,
    winnerPaidCampaignId: best.campaign.id,
    loserPaidCampaignId: worst.campaign.id,
    proposedDailyBudgetMinor: Math.round(best.campaign.dailyBudgetMinor * 1.2),
  };
}
