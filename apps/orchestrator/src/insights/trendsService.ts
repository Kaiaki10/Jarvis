import type { TrendsOverview } from "@jarvis/shared";
import { listWorkflows, listContentItems } from "../db/workflowRepo.js";
import { listCustomerOperations } from "../db/customerRepo.js";
import { paidGrowthOverview } from "../paidGrowth/service.js";

/**
 * A single read-only aggregation over data that already exists and is
 * already real — no new schema, no mutations, no automated allocation
 * decision. Modeled directly on paidGrowthOverview()'s shape: query the
 * existing repos, fold into plain counts. Deliberately the cheap first slice
 * of the GAPS.md attribution gap rather than the full ledger — descriptive
 * only, validates what's worth measuring before committing to that schema.
 */
export function trendsOverview(agentId?: string): TrendsOverview {
  const content = listContentItems(undefined, agentId);
  const workflows = listWorkflows(agentId);
  const customers = listCustomerOperations(agentId);
  const paidGrowth = paidGrowthOverview(agentId);

  const contentByStatus: TrendsOverview["content"]["byStatus"] = {};
  for (const item of content) {
    contentByStatus[item.status] = (contentByStatus[item.status] ?? 0) + 1;
  }

  const campaignsByStatus: TrendsOverview["workflows"]["byStatus"] = {};
  for (const campaign of workflows) {
    campaignsByStatus[campaign.status] = (campaignsByStatus[campaign.status] ?? 0) + 1;
  }

  const conversationsByStatus: TrendsOverview["customers"]["byStatus"] = {};
  for (const conversation of customers.conversations) {
    conversationsByStatus[conversation.status] = (conversationsByStatus[conversation.status] ?? 0) + 1;
  }
  const totalConversations = customers.conversations.length;
  const resolved = conversationsByStatus.resolved ?? 0;

  return {
    content: {
      total: content.length,
      byStatus: contentByStatus,
      publishedOrMeasured: (contentByStatus.published ?? 0) + (contentByStatus.measured ?? 0),
    },
    workflows: {
      total: workflows.length,
      byStatus: campaignsByStatus,
      active: campaignsByStatus.active ?? 0,
    },
    customers: {
      total: totalConversations,
      byStatus: conversationsByStatus,
      resolutionRate: totalConversations > 0 ? resolved / totalConversations : null,
    },
    paidGrowth: {
      activeCampaigns: paidGrowth.totals.active,
      currency: paidGrowth.totals.currency,
      spentMinor: paidGrowth.totals.spentMinor,
      revenueMinor: paidGrowth.totals.revenueMinor,
      roas: paidGrowth.totals.spentMinor > 0 ? paidGrowth.totals.revenueMinor / paidGrowth.totals.spentMinor : null,
    },
  };
}
