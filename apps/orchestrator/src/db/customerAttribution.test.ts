import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let gateway: typeof import("../customers/channelGateway.js");
let repo: typeof import("./customerRepo.js");

// The gateway's import graph is large; loading it once up front keeps the cold
// import out of the first test's 5s budget.
beforeAll(async () => {
  process.env.JARVIS_DB_PATH = join(mkdtempSync(join(tmpdir(), "jarvis-attribution-")), "attribution.db");
  gateway = await import("../customers/channelGateway.js");
  repo = await import("./customerRepo.js");
}, 120_000);

describe("customer attribution", () => {
  it("records the source of a website visitor's first message, including the referrer", () => {
    gateway.createWebsiteConversation({
      customerName: "Robin",
      customerEmail: "robin@example.com",
      body: "Do you ship to Canada?",
      utmSource: "twitter",
      utmCampaign: "fall-launch",
      referrer: "https://t.co/abc",
    });
    const customer = repo.getCustomerByEmail("robin@example.com")!;
    expect(customer).toMatchObject({
      acquisitionChannel: "x",
      utmSource: "twitter",
      utmCampaign: "fall-launch",
      referrer: "https://t.co/abc",
    });
  });

  it("accepts the null fields older widget builds sent", () => {
    gateway.createWebsiteConversation({ customerName: "Sam", customerEmail: "sam@example.com", body: "Hi", utmSource: null, utmMedium: null, utmCampaign: null, referrer: null });
    expect(repo.getCustomerByEmail("sam@example.com")).toMatchObject({ acquisitionChannel: "direct", utmSource: null, referrer: null });
  });

  it("keeps the first touch when a known customer returns from somewhere else", () => {
    gateway.createWebsiteConversation({ customerName: "Robin", customerEmail: "robin@example.com", body: "Back again", utmSource: "newsletter", referrer: "https://mail.google.com/" });
    expect(repo.getCustomerByEmail("robin@example.com")).toMatchObject({
      acquisitionChannel: "x",
      utmSource: "twitter",
      utmCampaign: "fall-launch",
      referrer: "https://t.co/abc",
    });
  });

  it("gives a customer created by a payment their source when they first get in touch", () => {
    const payer = repo.createCustomer({ name: "Kai", email: "kai@example.com" });
    repo.addCustomerRevenue(payer.id, 4_900);
    expect(repo.getCustomer(payer.id)?.acquisitionChannel).toBeNull();

    gateway.createWebsiteConversation({ customerName: "Kai", customerEmail: "KAI@example.com", body: "Question about my order", referrer: "https://www.google.com/" });
    expect(repo.getCustomer(payer.id)).toMatchObject({ acquisitionChannel: "search", referrer: "https://www.google.com/", revenueMinor: 4_900 });
  });

  it("attributes platform messages to the platform they arrived on", () => {
    const ingested = gateway.ingestCustomerMessage({ provider: "instagram", eventId: "ig-1", externalThreadId: "ig-user-1", customerName: "Instagram customer", subject: "DM", body: "Is this in stock?" });
    const conversation = repo.getCustomerConversation(ingested.conversationId!)!;
    expect(repo.getCustomer(conversation.customerId)?.acquisitionChannel).toBe("instagram");
  });

  it("does not label conversations logged by hand in the dashboard", () => {
    const created = repo.createCustomerConversation({ customerName: "Phone caller", channel: "website", subject: "Called in", message: "Wants a quote" });
    expect(created.customer.acquisitionChannel).toBeNull();
  });

  it("reports customers and revenue per channel, keeping unattributed customers visible", () => {
    const robin = repo.getCustomerByEmail("robin@example.com")!;
    repo.addCustomerRevenue(robin.id, 12_000);
    const unattributed = repo.createCustomer({ name: "Walk-in", email: "walkin@example.com" });
    repo.addCustomerRevenue(unattributed.id, 3_000);

    const byChannel = repo.attributionByChannel();
    expect(byChannel.find((row) => row.channel === "x")).toEqual({ channel: "x", count: 1, revenueMinor: 12_000 });
    expect(byChannel.find((row) => row.channel === "search")).toEqual({ channel: "search", count: 1, revenueMinor: 4_900 });
    expect(byChannel.find((row) => row.channel === null)).toMatchObject({ revenueMinor: 3_000 });
    expect(byChannel[0].channel).toBe("x");

    const totals = repo.attributionRevenueTotals();
    expect(totals.totalRevenueMinor).toBe(19_900);
    expect(totals.attributedRevenueMinor).toBe(16_900);
    expect(totals.customersWithRevenue).toBe(3);
    expect(totals.customerCount).toBeGreaterThan(totals.customersWithRevenue);
  });

  it("lists attributed customers with camelCase fields and respects the agent filter", () => {
    const rows = repo.listCustomersWithAttribution();
    const robin = rows.find((row) => row.email === "robin@example.com");
    expect(robin).toMatchObject({ acquisitionChannel: "x", utmSource: "twitter", utmCampaign: "fall-launch", referrer: "https://t.co/abc", revenueMinor: 12_000 });
    // Every row above belongs to no agent, so scoping to one must return none:
    // before the fix, the agent filter only applied to the revenue branch.
    expect(repo.listCustomersWithAttribution("some-other-agent")).toEqual([]);
  });
});
