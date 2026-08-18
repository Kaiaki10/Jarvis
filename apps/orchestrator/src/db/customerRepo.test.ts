import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-customers-"));
  process.env.JARVIS_DB_PATH = join(directory, "customers.db");
});

describe("customer operations repository", () => {
  it("keeps customer identity, conversation state, and messages durable", async () => {
    const repo = await import("./customerRepo.js");
    const created = repo.createCustomerConversation({
      customerName: "Avery Stone",
      customerEmail: "avery@example.com",
      company: "Northstar",
      channel: "website",
      subject: "Need help choosing a plan",
      message: "Which plan supports a five-person team?",
      priority: "high",
    });

    expect(created.conversation.unreadCount).toBe(1);
    expect(created.conversation.status).toBe("open");
    repo.createCustomerMessage({
      conversationId: created.conversation.id,
      direction: "outbound",
      sender: "jarvis",
      body: "I can help with that.",
    });

    const overview = repo.listCustomerOperations();
    expect(overview.customers).toHaveLength(1);
    expect(overview.messages).toHaveLength(2);
    expect(overview.conversations[0]).toMatchObject({ status: "waiting", unreadCount: 0 });
  });

  it("tracks a generated reply from running through review and use", async () => {
    const repo = await import("./customerRepo.js");
    const { createSession } = await import("./repo.js");
    const conversation = repo.listCustomerOperations().conversations[0];
    const session = createSession({ title: "Customer reply", cwd: process.cwd(), permissionMode: "default" });
    const draft = repo.createCustomerReplyDraft({ conversationId: conversation.id, sessionId: session.id });
    expect(draft.status).toBe("running");

    repo.finishCustomerReplyDraft(session.id, "ready", "Here is a useful answer.");
    expect(repo.getCustomerReplyDraftBySession(session.id)?.status).toBe("ready");
    repo.markCustomerReplyDraftUsed(draft.id);
    expect(repo.getCustomerReplyDraftBySession(session.id)?.status).toBe("used");
  });

  it("removes an orphaned customer when their final conversation is deleted", async () => {
    const repo = await import("./customerRepo.js");
    const conversation = repo.listCustomerOperations().conversations[0];
    repo.deleteCustomerConversation(conversation.id);
    expect(repo.listCustomerOperations().conversations).toHaveLength(0);
    expect(repo.listCustomerOperations().customers).toHaveLength(0);
  });
});
