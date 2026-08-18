import type {
  CustomerConversationRecord,
  CustomerMessageRecord,
  CustomerRecord,
} from "@jarvis/shared";
import {
  finishCustomerReplyDraft,
  getCustomerConversation,
  getCustomerReplyDraftBySession,
  getCustomerServicePolicy,
  markCustomerReplyDraftUsed,
} from "../db/customerRepo.js";
import { sendCustomerReply } from "./channelGateway.js";

export interface ParsedCustomerReply {
  body: string;
  confidence: number;
  requiresApproval: boolean;
  escalationReason: string | null;
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "result" in result && typeof result.result === "string") {
    return result.result;
  }
  return "";
}

export function parseCustomerReply(result: unknown): ParsedCustomerReply {
  const text = resultText(result);
  const tagged = text.match(/<jarvis-customer-reply>\s*([\s\S]*?)\s*<\/jarvis-customer-reply>/i)?.[1]?.trim();
  if (!tagged) throw new Error("Jarvis returned no customer reply draft.");
  if (tagged.length > 10_000) throw new Error("Jarvis returned a reply that is too long.");
  try {
    const parsed = JSON.parse(tagged) as Partial<ParsedCustomerReply>;
    if (typeof parsed.body !== "string" || !parsed.body.trim()) throw new Error("missing body");
    if (parsed.body.length > 10_000) throw new Error("reply is too long");
    const confidence = Number(parsed.confidence);
    return {
      body: parsed.body.trim(),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      requiresApproval: parsed.requiresApproval !== false,
      escalationReason: typeof parsed.escalationReason === "string" && parsed.escalationReason.trim()
        ? parsed.escalationReason.trim()
        : null,
    };
  } catch {
    return { body: tagged, confidence: 0, requiresApproval: true, escalationReason: null };
  }
}

export function customerReplyPrompt(input: {
  customer: CustomerRecord;
  conversation: CustomerConversationRecord;
  messages: CustomerMessageRecord[];
  businessContext: string;
}): string {
  const history = input.messages.slice(-20).map((message) =>
    `[${message.sender}, ${message.direction}] ${message.body}`
  ).join("\n");

  return `You are Jarvis acting as a careful customer service teammate. Draft one response and assess whether it is safe to send automatically.

Business context:
${input.businessContext.trim() || "No additional business context is configured."}

Customer:
Name: ${input.customer.name}
Company: ${input.customer.company ?? "Not provided"}
Known notes: ${input.customer.notes ?? "None"}

Conversation:
Channel: ${input.conversation.channel}
Subject: ${input.conversation.subject}
Priority: ${input.conversation.priority}
Sentiment: ${input.conversation.sentiment}

Recent messages:
${history}

Requirements:
- Be concise, warm, specific, and useful.
- Answer only from the provided business context and conversation.
- Do not invent policies, refunds, timelines, discounts, account details, or completed actions.
- If a fact or authorization is missing, say what you can do next without exposing internal uncertainty.
- Set requiresApproval to true for refunds, credits, discounts, cancellation, legal or safety issues, account-specific claims, uncertain facts, angry customers, or any promise of a future outcome.
- Confidence means confidence that every claim is supported by the supplied context, not confidence in writing quality.
- Do not use tools, send anything, or modify files.
- Return only strict JSON inside the exact tags below. Do not use Markdown fences.

<jarvis-customer-reply>
{"body":"Your complete customer-facing reply","confidence":0.0,"requiresApproval":true,"escalationReason":null}
</jarvis-customer-reply>`;
}

const SENSITIVE_CLAIM = /\b(refund(?:ed)?|credit(?:ed)?|discount|cancel(?:led|ed)?|waive(?:d)?|guarantee(?:d)?|promise(?:d)?|legal|lawsuit|chargeback|fraud|compensat(?:e|ion)|within \d+ (?:hours?|days?))\b/i;

export async function reconcileCustomerReplyDraft(input: { sessionId: string; result: unknown; ok: boolean }): Promise<boolean> {
  const draft = getCustomerReplyDraftBySession(input.sessionId);
  if (!draft || draft.status !== "running") return false;
  if (!input.ok) {
    finishCustomerReplyDraft(input.sessionId, "failed", undefined, "The Jarvis drafting run failed.");
    return true;
  }
  try {
    const parsed = parseCustomerReply(input.result);
    const sensitive = SENSITIVE_CLAIM.test(parsed.body);
    const review = {
      confidence: parsed.confidence,
      requiresApproval: parsed.requiresApproval || sensitive,
      escalationReason: parsed.escalationReason ?? (sensitive ? "Sensitive commitment requires review." : null),
    };
    const ready = finishCustomerReplyDraft(input.sessionId, "ready", parsed.body, undefined, review);
    if (!draft.autoSend || !ready) return true;
    const conversation = getCustomerConversation(draft.conversationId);
    const policy = getCustomerServicePolicy();
    const channelEnabled = conversation?.channel === "website" ? policy.autoReplyWebsite
      : conversation?.channel === "email" ? policy.autoReplyEmail : policy.autoReplySocial;
    if (!conversation || !policy.enabled || !channelEnabled || conversation.assignedTo !== "jarvis" || conversation.status === "resolved" || review.requiresApproval || review.confidence < policy.confidenceThreshold) return true;
    try {
      await sendCustomerReply({ conversationId: conversation.id, channel: conversation.channel, body: parsed.body, sender: "jarvis", draftId: draft.id });
      markCustomerReplyDraftUsed(draft.id);
    } catch (error) {
      finishCustomerReplyDraft(input.sessionId, "ready", parsed.body, undefined, {
        ...review,
        requiresApproval: true,
        escalationReason: `Automatic delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } catch (error) {
    finishCustomerReplyDraft(
      input.sessionId,
      "failed",
      undefined,
      error instanceof Error ? error.message : String(error)
    );
  }
  return true;
}
