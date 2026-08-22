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

  const ranked = candidates
    .map((campaign) => ({ campaign, roas: paidGrowthMetrics(campaign).roas }))
    .filter((entry): entry is { campaign: PaidGrowthCampaignRecord; roas: number } =>
      entry.roas !== null && entry.campaign.conversions >= 2
    )
    .sort((a, b) => b.roas - a.roas);
  const best = ranked[0];
  const worst = ranked.at(-1);
  if (best && worst && best.campaign.id !== worst.campaign.id && best.roas >= worst.roas * 1.5) {
    recommendations.push({
      paidCampaignId: best.campaign.id,
      kind: "reallocate",
      reason: `${best.campaign.name} is producing ${best.roas.toFixed(2)}× ROAS versus ${worst.roas.toFixed(2)}× for ${worst.campaign.name}.`,
      proposedDailyBudgetMinor: Math.round(best.campaign.dailyBudgetMinor * 1.2),
      sourcePaidCampaignId: worst.campaign.id,
    });
  }

  return recommendations;
}
