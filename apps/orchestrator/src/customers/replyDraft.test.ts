import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-customer-drafts-"));
  process.env.JARVIS_DB_PATH = join(directory, "drafts.db");
});

describe("customer reply drafting", () => {
  it("extracts only the tagged customer-facing response", async () => {
    const { parseCustomerReply } = await import("./replyDraft.js");
    expect(parseCustomerReply("<jarvis-customer-reply>Happy to help. What size is your team?</jarvis-customer-reply>"))
      .toEqual({ body: "Happy to help. What size is your team?", confidence: 0, requiresApproval: true, escalationReason: null });
    expect(parseCustomerReply('<jarvis-customer-reply>{"body":"The Growth plan supports five people.","confidence":0.96,"requiresApproval":false,"escalationReason":null}</jarvis-customer-reply>'))
      .toEqual({ body: "The Growth plan supports five people.", confidence: 0.96, requiresApproval: false, escalationReason: null });
    expect(() => parseCustomerReply("No tagged reply")).toThrow("no customer reply");
  });

  it("grounds the prompt in business, customer, and conversation context", async () => {
    const { customerReplyPrompt } = await import("./replyDraft.js");
    const prompt = customerReplyPrompt({
      businessContext: "Teams of five use the Growth plan.",
      customer: {
        id: "customer-1", name: "Avery", email: "avery@example.com", company: "Northstar",
        notes: "Prefers concise answers", createdAt: "2026-01-01", updatedAt: "2026-01-01",
      },
      conversation: {
        id: "conversation-1", customerId: "customer-1", channel: "website", subject: "Plans",
        status: "open", priority: "normal", sentiment: "neutral", assignedTo: "jarvis", summary: null,
        unreadCount: 1, lastMessageAt: "2026-01-01", createdAt: "2026-01-01", updatedAt: "2026-01-01",
      },
      messages: [{
        id: "message-1", conversationId: "conversation-1", direction: "inbound", sender: "customer",
        body: "What supports five people?", createdAt: "2026-01-01",
      }],
    });
    expect(prompt).toContain("Growth plan");
    expect(prompt).toContain("Prefers concise answers");
    expect(prompt).toContain("What supports five people?");
    expect(prompt).toContain("Do not invent policies");
  });
});
