import type { PaidGrowthCampaignRecord } from "@jarvis/shared";
import { getConnection } from "../db/connectionsRepo.js";
import { listPaidGrowthCampaigns } from "../db/paidGrowthRepo.js";
import { getSettings } from "../db/repo.js";
import { globalBus } from "../events/globalBus.js";
import { notify } from "../notifications/notifier.js";
import { applyPauseDecision, syncPaidGrowthCampaign } from "./service.js";

const CHECK_INTERVAL_MS = 15 * 60_000;

export function findPaidGrowthSyncCandidate(workflows: PaidGrowthCampaignRecord[], now = Date.now()) {
  return workflows.find((campaign) => {
    if (campaign.status !== "active" || !campaign.externalCampaignId) return false;
    if (getConnection(campaign.platform)?.status !== "connected") return false;
    return !campaign.lastSyncedAt || now - new Date(campaign.lastSyncedAt).getTime() >= CHECK_INTERVAL_MS;
  });
}

export async function tickPaidGrowthMonitor(now = Date.now()): Promise<boolean> {
  if (!getSettings().automationsEnabled) return false;
  const campaign = findPaidGrowthSyncCandidate(listPaidGrowthCampaigns(), now);
  if (!campaign) return false;
  try {
    const result = await syncPaidGrowthCampaign(campaign.id);
    for (const decision of result.decisions) {
      // Loss-cutting applies itself: a pause only ever stops spend, and a
      // bleeding campaign should not spend another 15 minutes waiting for a
      // human to notice. Everything else still proposes. Resuming is never
      // automatic — see applyPauseDecision.
      if (decision.kind === "pause") {
        try {
          await applyPauseDecision(decision.id);
          notify({
            type: "paid_growth_approval",
            severity: "warning",
            title: "Campaign paused automatically",
            body: `${result.campaign.name}: ${decision.reason} Resume it from Paid Growth if this was wrong.`,
          });
        } catch (error) {
          notify({
            type: "paid_growth_approval",
            severity: "warning",
            title: "Automatic pause failed",
            body: `${result.campaign.name}: ${decision.reason} It still needs a human: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        continue;
      }
      notify({
        type: "paid_growth_approval",
        severity: "info",
        title: "Paid growth decision ready",
        body: `${result.campaign.name}: ${decision.reason}`,
      });
    }
    globalBus.emit("paid_growth_changed");
    return true;
  } catch (error) {
    console.error(`[paid-growth] performance sync failed for "${campaign.name}":`, error);
    return false;
  }
}

export function startPaidGrowthMonitor(): void {
  void tickPaidGrowthMonitor();
  setInterval(() => void tickPaidGrowthMonitor(), CHECK_INTERVAL_MS);
}
