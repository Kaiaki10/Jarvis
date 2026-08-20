import { describe, expect, it } from "vitest";

describe("trendsOverview", () => {
  it("counts content, campaigns, customer resolution, and paid ROAS for one agent, scoped away from another's", async () => {
    const { createAgent } = await import("../db/agentRepo.js");
    const { createCampaign, createContentItem, updateContentItem, updateCampaign } = await import(
      "../db/campaignRepo.js"
    );
    const { createCustomerConversation, updateCustomerConversation } = await import(
      "../db/customerRepo.js"
    );
    const { createPaidGrowthCampaign, updatePaidGrowthPerformance } = await import(
      "../db/paidGrowthRepo.js"
    );
    const { trendsOverview } = await import("./trendsService.js");

    const agent = createAgent({ name: "Trends Test Agent" });
    const other = createAgent({ name: "Someone Else's Agent" });

    // Content: one published (counts toward publishedOrMeasured), one left as draft.
    const campaign = createCampaign({
      name: "Test campaign",
      objective: "Grow",
      audience: "Everyone",
      offer: "Something",
      channels: ["x"],
      primaryMetric: "clicks",
      approvalPolicy: "each_item",
      agentId: agent.id,
    });
    updateCampaign(campaign.id, { status: "active" });
    const published = createContentItem({
      campaignId: campaign.id,
      title: "Published post",
      body: "...",
      format: "social_post",
      channel: "x",
    });
    updateContentItem(published.id, { status: "published" });
    createContentItem({
      campaignId: campaign.id,
      title: "Still a draft",
      body: "...",
      format: "social_post",
      channel: "x",
    });

    // Customers: one resolved, one left open -> resolution rate should be 1/2.
    const { conversation: resolved } = createCustomerConversation({
      customerName: "Resolved Customer",
      channel: "email",
      subject: "Question",
      message: "Hi",
      agentId: agent.id,
    });
    updateCustomerConversation(resolved.id, { status: "resolved" });
    createCustomerConversation({
      customerName: "Open Customer",
      channel: "email",
      subject: "Another question",
      message: "Hi",
      agentId: agent.id,
    });

    // Paid growth: 200 spent, 600 revenue -> ROAS 3.
    const paidCampaign = createPaidGrowthCampaign({
      name: "Paid test",
      objective: "Grow",
      platform: "google_ads",
      currency: "USD",
      dailyBudgetMinor: 1000,
      lifetimeBudgetMinor: 10000,
      startDate: "2026-01-01",
      agentId: agent.id,
    });
    updatePaidGrowthPerformance(paidCampaign.id, {
      spentMinor: 200,
      revenueMinor: 600,
      impressions: 100,
      clicks: 10,
      conversions: 2,
    });

    const overview = trendsOverview(agent.id);

    expect(overview.content.total).toBe(2);
    expect(overview.content.publishedOrMeasured).toBe(1);
    expect(overview.content.byStatus.published).toBe(1);
    expect(overview.content.byStatus.draft).toBe(1);

    expect(overview.campaigns.total).toBe(1);
    expect(overview.campaigns.active).toBe(1);

    expect(overview.customers.total).toBe(2);
    expect(overview.customers.resolutionRate).toBe(0.5);

    expect(overview.paidGrowth.spentMinor).toBe(200);
    expect(overview.paidGrowth.revenueMinor).toBe(600);
    expect(overview.paidGrowth.roas).toBe(3);

    // The whole point of scoping: another agent's overview must not see any of this.
    const otherOverview = trendsOverview(other.id);
    expect(otherOverview.content.total).toBe(0);
    expect(otherOverview.campaigns.total).toBe(0);
    expect(otherOverview.customers.total).toBe(0);
    expect(otherOverview.paidGrowth.spentMinor).toBe(0);
    expect(otherOverview.paidGrowth.roas).toBeNull();
  });

  it("reports null rates rather than zero when there is nothing to divide", async () => {
    const { createAgent } = await import("../db/agentRepo.js");
    const { trendsOverview } = await import("./trendsService.js");

    const empty = createAgent({ name: "Empty Agent" });
    const overview = trendsOverview(empty.id);

    expect(overview.customers.resolutionRate).toBeNull();
    expect(overview.paidGrowth.roas).toBeNull();
  });
});
