import { existsSync, statSync } from "node:fs";
import type { CustomerChannel, CustomerConversationRecord } from "@jarvis/shared";
import { createSession, createTask, getSettings } from "../db/repo.js";
import {
  countAutomaticReplies,
  createCustomerMessage,
  createCustomerReplyDraft,
  getCustomer,
  getCustomerConversation,
  getCustomerServicePolicy,
  listCustomerMessages,
  updateCustomerConversation,
} from "../db/customerRepo.js";
import { notify } from "../notifications/notifier.js";
import { activeSessionCount, atConcurrencyLimit, startSession } from "../sessions/sessionManager.js";
import { customerReplyPrompt } from "./replyDraft.js";
import { globalBus } from "../events/globalBus.js";

function channelEnabled(channel: CustomerChannel): boolean {
  const policy = getCustomerServicePolicy();
  if (channel === "website") return policy.autoReplyWebsite;
  if (channel === "email") return policy.autoReplyEmail;
  return policy.autoReplySocial;
}

function inBusinessHours(now = new Date()): boolean {
  const policy = getCustomerServicePolicy();
  if (!policy.businessDays.includes(now.getDay())) return false;
  const local = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return local >= policy.businessHoursStart && local <= policy.businessHoursEnd;
}

export function automaticReplyDecision(conversation: CustomerConversationRecord, body: string, now = new Date()): {
  allowed: boolean;
  escalationReason?: string;
} {
  const policy = getCustomerServicePolicy();
  const keyword = policy.escalationKeywords.find((value) => value && body.toLowerCase().includes(value.toLowerCase()));
  if (keyword) return { allowed: false, escalationReason: `Escalation keyword detected: ${keyword}` };
  if (!policy.enabled || !channelEnabled(conversation.channel)) return { allowed: false };
  if (conversation.assignedTo !== "jarvis" || conversation.status === "resolved") return { allowed: false };
  if (!inBusinessHours(now)) return { allowed: false };
  if (countAutomaticReplies(conversation.id) >= policy.maxAutoRepliesPerConversation) {
    return { allowed: false, escalationReason: "Automatic reply limit reached." };
  }
  return { allowed: true };
}

export function escalateCustomerConversation(conversationId: string, reason: string): void {
  const conversation = getCustomerConversation(conversationId);
  if (!conversation || conversation.assignedTo === "human") return;
  const customer = getCustomer(conversation.customerId);
  updateCustomerConversation(conversationId, { assignedTo: "human", priority: "high", status: "open" });
  createCustomerMessage({ conversationId, direction: "internal", sender: "system", body: reason });
  createTask({
    title: `Customer escalation: ${conversation.subject}`,
    description: `Review the ${conversation.channel} conversation with ${customer?.name ?? "customer"}. ${reason}`,
  });
  notify({ type: "customer_escalation", severity: "warning", title: `Customer needs attention: ${customer?.name ?? conversation.subject}`, body: reason });
  globalBus.emit("customers_changed");
  globalBus.emit("missions_changed");
}

export function startCustomerReplyDraft(conversationId: string, autoSend = false) {
  const conversation = getCustomerConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  const customer = getCustomer(conversation.customerId);
  if (!customer) throw new Error("Conversation customer is missing.");
  if (atConcurrencyLimit()) {
    throw new Error(`Too many sessions running at once (${activeSessionCount()}/${getSettings().maxConcurrentSessions}).`);
  }
  const cwd = getSettings().chatWorkingDirectory.trim() || process.cwd();
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Chat working directory does not exist: ${cwd}.`);
  const session = createSession({ title: `Customer reply · ${customer.name}`.slice(0, 120), cwd, permissionMode: "default" });
  const draft = createCustomerReplyDraft({ conversationId, sessionId: session.id, autoSend });
  globalBus.emit("session_updated", session.id);
  globalBus.emit("customers_changed");
  void startSession({
    id: session.id,
    prompt: customerReplyPrompt({ customer, conversation, messages: listCustomerMessages(conversation.id), businessContext: getSettings().businessContext }),
    cwd,
    permissionMode: "default",
    title: session.title,
  });
  return { session, draft };
}

export function handleCustomerInbound(conversationId: string, body: string): void {
  const conversation = getCustomerConversation(conversationId);
  if (!conversation) return;
  const decision = automaticReplyDecision(conversation, body);
  if (decision.escalationReason) {
    escalateCustomerConversation(conversationId, decision.escalationReason);
    return;
  }
  if (!decision.allowed) return;
  try {
    startCustomerReplyDraft(conversationId, true);
  } catch (error) {
    console.error("[customers] automatic draft could not start:", error);
  }
}
