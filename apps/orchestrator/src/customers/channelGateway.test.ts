import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.JARVIS_DB_PATH = join(mkdtempSync(join(tmpdir(), "jarvis-channel-gateway-")), "gateway.db");
});

describe("customer channel gateway", () => {
  it("protects website conversations with an unguessable token and records delivery", async () => {
    const gateway = await import("./channelGateway.js");
    const repo = await import("../db/customerRepo.js");
    const created = gateway.createWebsiteConversation({ customerName: "Avery", body: "Hello" });
    expect(created.token.length).toBeGreaterThan(30);
    expect(gateway.authorizeWebsiteConversation(created.conversationId, created.token)).toBe(true);
    expect(gateway.authorizeWebsiteConversation(created.conversationId, "not-the-token-at-all-0000000000")).toBe(false);

    const reply = await gateway.sendCustomerReply({ conversationId: created.conversationId, channel: "website", body: "Hi Avery", sender: "jarvis" });
    expect(repo.listCustomerOperations().deliveries.find((item) => item.messageId === reply.id)).toMatchObject({ status: "recorded", provider: "website" });
  });

  it("deduplicates provider events before adding another customer message", async () => {
    const gateway = await import("./channelGateway.js");
    const first = gateway.ingestCustomerMessage({ provider: "x", eventId: "dm-1", externalThreadId: "42", customerName: "X customer", subject: "DM", body: "Need help" });
    const duplicate = gateway.ingestCustomerMessage({ provider: "x", eventId: "dm-1", externalThreadId: "42", customerName: "X customer", subject: "DM", body: "Need help" });
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
  });

  it("allows routine replies but blocks escalation language at the policy boundary", async () => {
    const repo = await import("../db/customerRepo.js");
    const service = await import("./customerService.js");
    repo.updateCustomerServicePolicy({ enabled: true, autoReplyWebsite: true, businessDays: [2], businessHoursStart: "09:00", businessHoursEnd: "17:00" });
    const created = repo.createCustomerConversation({ customerName: "Sam", channel: "website", subject: "Question", message: "What time do you open?" });
    const now = new Date(2026, 7, 18, 10, 0);
    expect(service.automaticReplyDecision(created.conversation, "What time do you open?", now).allowed).toBe(true);
    expect(service.automaticReplyDecision(created.conversation, "I want a refund", now)).toMatchObject({ allowed: false, escalationReason: expect.stringContaining("refund") });
  });
});
