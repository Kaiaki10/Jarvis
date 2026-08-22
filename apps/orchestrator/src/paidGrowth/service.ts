import type { PaidGrowthOverview } from "@jarvis/shared";
import { checkCapacity } from "../billing/envelopes.js";
import { getConnection } from "../db/connectionsRepo.js";
import {
  createPaidGrowthDecision,
  activeAdBudgetMinor,
  getPaidGrowthCampaign,
  getPaidGrowthDecision,
  hasOpenPaidGrowthDecision,
  listPaidGrowthCampaigns,
  listPaidGrowthDecisions,
  reviewPaidGrowthDecision,
  updatePaidGrowthCampaign,
  updatePaidGrowthPerformance,
} from "../db/paidGrowthRepo.js";
import { paidGrowthMetrics, recommendPaidGrowthActions } from "./engine.js";
import { syncPaidGrowthPerformance } from "./adapters.js";
import { executePaidGrowthAction } from "./executor.js";

export function paidGrowthOverview(agentId?: string): PaidGrowthOverview {
  const campaigns = listPaidGrowthCampaigns(agentId).map((campaign) => ({
    ...campaign,
    metrics: paidGrowthMetrics(campaign),
    connectionReady: getConnection(campaign.platform)?.status === "connected",
  }));
  const decisions = listPaidGrowthDecisions(agentId);
  const currencies = new Set(campaigns.map((campaign) => campaign.currency));
  return {
    campaigns,
    decisions,
    totals: {
      currency: currencies.size <= 1 ? campaigns[0]?.currency ?? "USD" : null,
      approvedBudgetMinor: campaigns.reduce((sum, campaign) => sum + campaign.approvedBudgetMinor, 0),
      spentMinor: campaigns.reduce((sum, campaign) => sum + campaign.spentMinor, 0),
      revenueMinor: campaigns.reduce((sum, campaign) => sum + campaign.revenueMinor, 0),
      active: campaigns.filter((campaign) => campaign.status === "active").length,
      waitingApproval: decisions.filter((decision) => decision.status === "proposed").length,
    },
  };
}

export function requestPaidGrowthLaunch(id: string, agentId?: string) {
  const campaign = getPaidGrowthCampaign(id, agentId);
  if (!campaign) throw new Error("Paid campaign not found");
  if (!campaign.externalCampaignId) throw new Error("Link the existing platform campaign ID before requesting activation");
  if (getConnection(campaign.platform)?.status !== "connected") {
    throw new Error(`Test the ${campaign.platform} connection before requesting activation`);
  }
  if (!["draft", "paused"].includes(campaign.status)) {
    throw new Error(`A ${campaign.status} campaign cannot request activation`);
  }
  if (hasOpenPaidGrowthDecision(id, "launch")) throw new Error("Activation is already waiting for approval");
  const decision = createPaidGrowthDecision({
    paidCampaignId: id,
    kind: "launch",
    reason: `Authorize up to ${campaign.lifetimeBudgetMinor} minor currency units, paced at ${campaign.dailyBudgetMinor} per day.`,
    proposedDailyBudgetMinor: campaign.dailyBudgetMinor,
  });
  updatePaidGrowthCampaign(id, { status: "pending_approval" });
  return decision;
}

export function refreshPaidGrowthRecommendations(agentId?: string) {
  const created = [];
  for (const recommendation of recommendPaidGrowthActions(listPaidGrowthCampaigns(agentId))) {
    if (hasOpenPaidGrowthDecision(recommendation.paidCampaignId, recommendation.kind)) continue;
    created.push(createPaidGrowthDecision(recommendation));
  }
  return created;
}

export async function syncPaidGrowthCampaign(id: string, agentId?: string) {
  const campaign = getPaidGrowthCampaign(id, agentId);
  if (!campaign) throw new Error("Paid campaign not found");
  if (getConnection(campaign.platform)?.status !== "connected") {
    throw new Error(`Test the ${campaign.platform} connection before syncing performance`);
  }
  const synced = await syncPaidGrowthPerformance(campaign);
  const performance = synced.mode === "increment" ? {
    spentMinor: campaign.spentMinor + synced.performance.spentMinor,
    revenueMinor: campaign.revenueMinor,
    impressions: campaign.impressions + synced.performance.impressions,
    clicks: campaign.clicks + synced.performance.clicks,
    conversions: campaign.conversions + synced.performance.conversions,
  } : {
    ...synced.performance,
    // X does not expose attributed monetary value in this report. Preserve any
    // manually or externally attributed revenue already in Jarvis.
    revenueMinor: campaign.platform === "x_ads" ? campaign.revenueMinor : synced.performance.revenueMinor,
  };
  if (performance.spentMinor < campaign.spentMinor) {
    throw new Error("The platform returned less cumulative spend than Jarvis has already recorded");
  }
  const updated = updatePaidGrowthPerformance(id, performance, true)!;
  const decisions = refreshPaidGrowthRecommendations(agentId);
  return { campaign: updated, decisions };
}

export async function decidePaidGrowthRecommendation(id: string, decision: "approve" | "reject") {
  const current = getPaidGrowthDecision(id);
  if (!current) throw new Error("Paid growth decision not found");
  if (current.status !== "proposed") throw new Error("This decision has already been reviewed");
  const campaign = getPaidGrowthCampaign(current.paidCampaignId);
  if (!campaign) throw new Error("Paid campaign not found");
  if (decision === "reject") return reviewPaidGrowthDecision(id, "rejected")!;

  if (getConnection(campaign.platform)?.status !== "connected") {
    throw new Error(`Reconnect ${campaign.platform} before applying this decision`);
  }
  // Checked before the platform call, so a refusal never leaves a live campaign
  // Jarvis then has to walk back. Capacity rather than spend: the platforms
  // enforce each campaign's own budget, but nothing stopped Jarvis running ten
  // campaigns at once — the envelope bounds the total daily commitment.
  //
  // Launch adds a campaign that is not yet counted; an increase adds only the
  // delta, since the campaign's current budget is already in the total.
  const adCapacity = (addingMinor: number, excludeIds: string[] = []) =>
    checkCapacity({
      rail: "ad_budget",
      committedMinor: activeAdBudgetMinor(campaign.currency, excludeIds),
      addingMinor,
      currency: campaign.currency,
      period: "day",
    });

  if (current.kind === "launch") {
    const check = adCapacity(campaign.dailyBudgetMinor);
    if (!check.allowed) throw new Error(check.reason ?? "This launch is outside the ad budget limit.");
    await executePaidGrowthAction(campaign, { dailyBudgetMinor: campaign.dailyBudgetMinor, status: "active" });
    updatePaidGrowthCampaign(campaign.id, {
      status: "active",
      approvedBudgetMinor: campaign.lifetimeBudgetMinor,
    });
  } else if (current.kind === "increase_budget" && current.proposedDailyBudgetMinor) {
    // Only the increase is new capacity. Excluding this campaign from the
    // committed total and adding the full proposal comes to the same thing and
    // stays correct if the stored budget and the platform's ever disagree.
    const check = adCapacity(current.proposedDailyBudgetMinor, [campaign.id]);
    if (!check.allowed) throw new Error(check.reason ?? "This increase is outside the ad budget limit.");
    await executePaidGrowthAction(campaign, { dailyBudgetMinor: current.proposedDailyBudgetMinor });
    updatePaidGrowthCampaign(campaign.id, { dailyBudgetMinor: current.proposedDailyBudgetMinor });
  } else if (current.kind === "pause") {
    await executePaidGrowthAction(campaign, { status: "paused" });
    updatePaidGrowthCampaign(campaign.id, { status: "paused" });
  } else if (current.kind === "reallocate" && current.proposedDailyBudgetMinor) {
    let source: ReturnType<typeof getPaidGrowthCampaign> = undefined;
    let sourceBudget: number | undefined;
    if (current.sourcePaidCampaignId) {
      source = getPaidGrowthCampaign(current.sourcePaidCampaignId);
      if (source) sourceBudget = Math.max(100, Math.round(source.dailyBudgetMinor * 0.8));
    }

    // Reallocation is not automatically neutral: the source is cut by 20% while
    // the target can rise by more, so the total can still grow. Both new
    // budgets are checked together, before either platform call — a refusal
    // halfway through would leave the source cut and the target unchanged.
    const bothExcluded = source ? [campaign.id, source.id] : [campaign.id];
    const check = adCapacity(
      current.proposedDailyBudgetMinor + (sourceBudget ?? 0),
      bothExcluded
    );
    if (!check.allowed) throw new Error(check.reason ?? "This reallocation is outside the ad budget limit.");

    if (source && sourceBudget) {
      await executePaidGrowthAction(source, { dailyBudgetMinor: sourceBudget });
    }
    await executePaidGrowthAction(campaign, { dailyBudgetMinor: current.proposedDailyBudgetMinor });
    if (source && sourceBudget) updatePaidGrowthCampaign(source.id, { dailyBudgetMinor: sourceBudget });
    updatePaidGrowthCampaign(campaign.id, { dailyBudgetMinor: current.proposedDailyBudgetMinor });
  }
  return reviewPaidGrowthDecision(id, "applied")!;
}
