import { getSettings } from "../db/repo.js";
import { listDueContentItems } from "../db/campaignRepo.js";
import { startContentPublication, contentPublishingReadiness } from "./publicationService.js";

const CHECK_INTERVAL_MS = 60_000;

export function tickContentPublishing(now = new Date()): boolean {
  if (!getSettings().automationsEnabled) return false;
  for (const item of listDueContentItems(now.toISOString())) {
    if (!contentPublishingReadiness(item).ready) continue;
    try {
      startContentPublication(item);
      return true;
    } catch (error) {
      console.error(`[campaigns] could not start scheduled publication for "${item.title}":`, error);
      return false;
    }
  }
  return false;
}

export function startContentPublishingScheduler(): void {
  tickContentPublishing();
  setInterval(() => tickContentPublishing(), CHECK_INTERVAL_MS);
}
