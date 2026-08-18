import type { PaidGrowthCampaignRecord } from "@jarvis/shared";
import { getConnection } from "../db/connectionsRepo.js";
import { listPaidGrowthCampaigns } from "../db/paidGrowthRepo.js";
import { getSettings } from "../db/repo.js";
import { globalBus } from "../events/globalBus.js";
import { notify } from "../notifications/notifier.js";
import { syncPaidGrowthCampaign } from "./service.js";

const CHECK_INTERVAL_MS = 15 * 60_000;

export function findPaidGrowthSyncCandidate(campaigns: PaidGrowthCampaignRecord[], now = Date.now()) {
  return campaigns.find((campaign) => {
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
      notify({
        type: "paid_growth_approval",
        severity: decision.kind === "pause" ? "warning" : "info",
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
