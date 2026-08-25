import type {
  PaidGrowthCampaignRecord,
  PaidGrowthDecisionKind,
  PaidGrowthMetrics,
} from "@jarvis/shared";

export function paidGrowthMetrics(campaign: PaidGrowthCampaignRecord): PaidGrowthMetrics {
  return {
    ctr: campaign.impressions > 0 ? campaign.clicks / campaign.impressions : null,
    cpcMinor: campaign.clicks > 0 ? campaign.spentMinor / campaign.clicks : null,
    costPerConversionMinor:
      campaign.conversions > 0 ? campaign.spentMinor / campaign.conversions : null,
    roas: campaign.spentMinor > 0 ? campaign.revenueMinor / campaign.spentMinor : null,
    budgetUtilization:
      campaign.lifetimeBudgetMinor > 0
        ? Math.min(campaign.spentMinor / campaign.lifetimeBudgetMinor, 1)
        : 0,
  };
}

export interface PaidGrowthRecommendation {
  paidCampaignId: string;
  kind: PaidGrowthDecisionKind;
  reason: string;
  proposedDailyBudgetMinor: number | null;
  sourcePaidCampaignId: string | null;
}

export function recommendPaidGrowthActions(
  workflows: PaidGrowthCampaignRecord[]
): PaidGrowthRecommendation[] {
  const candidates = workflows.filter((campaign) =>
    ["approved", "active"].includes(campaign.status)
  );
  const recommendations: PaidGrowthRecommendation[] = [];

  for (const campaign of candidates) {
    const metrics = paidGrowthMetrics(campaign);
    if (campaign.spentMinor >= campaign.lifetimeBudgetMinor) {
      recommendations.push({
        paidCampaignId: campaign.id,
        kind: "pause",
        reason: "The approved lifetime budget has been fully used.",
        proposedDailyBudgetMinor: null,
        sourcePaidCampaignId: null,
      });
      continue;
    }
    if (
      campaign.targetRoas &&
      metrics.roas !== null &&
      campaign.spentMinor >= campaign.dailyBudgetMinor * 2 &&
      metrics.roas < campaign.targetRoas * 0.7
    ) {
      recommendations.push({
        paidCampaignId: campaign.id,
        kind: "pause",
        reason: `ROAS is ${metrics.roas.toFixed(2)}×, materially below the ${campaign.targetRoas.toFixed(2)}× target after meaningful spend.`,
        proposedDailyBudgetMinor: null,
        sourcePaidCampaignId: null,
      });
      continue;
    }
    if (
      campaign.targetRoas &&
      metrics.roas !== null &&
      metrics.roas >= campaign.targetRoas * 1.2 &&
      campaign.conversions >= 3
    ) {
      recommendations.push({
        paidCampaignId: campaign.id,
        kind: "increase_budget",
        reason: `ROAS is ${metrics.roas.toFixed(2)}× with ${campaign.conversions} conversions, above the ${campaign.targetRoas.toFixed(2)}× target.`,
        proposedDailyBudgetMinor: Math.round(campaign.dailyBudgetMinor * 1.2),
        sourcePaidCampaignId: null,
      });
    }
  }

  // Reallocation used to be proposed here too, ranking every unrelated active
  // campaign globally by ROAS. That compared campaigns with different
  // objectives against each other with no context. It's replaced by
  // `experimentEngine.ts`'s `evaluateExperiment`, which only compares
  // campaigns a human deliberately grouped into a declared experiment, against
  // a stricter, explicit conclusion rule. See GAPS.md's attribution gap.

  return recommendations;
}
