import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { CustomerChannel, CustomerMessageRecord } from "@jarvis/shared";
import { getConnection, getConnectionCredentials } from "../db/connectionsRepo.js";
import {
  bindCustomerChannelThread,
  createCustomerConversation,
  createCustomerMessage,
  getConversationChannelThread,
  getCustomerChannelThread,
  recordCustomerInboundEvent,
  recordCustomerMessageDelivery,
} from "../db/customerRepo.js";
import { oauth1Header } from "../platforms/oauth1.js";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeSecretEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface InboundCustomerMessage {
  provider: CustomerChannel;
  eventId: string;
  externalThreadId: string;
  customerName: string;
  customerEmail?: string;
  subject: string;
  body: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export function ingestCustomerMessage(input: InboundCustomerMessage): {
  duplicate: boolean;
  conversationId?: string;
  message?: CustomerMessageRecord;
} {
  if (!recordCustomerInboundEvent(input.provider, input.eventId, sha256(JSON.stringify(input)))) {
    return { duplicate: true };
  }

  let thread = getCustomerChannelThread(input.provider, input.externalThreadId);
  if (!thread) {
    const created = createCustomerConversation({
      customerName: input.customerName.trim() || "Customer",
      customerEmail: input.customerEmail?.trim(),
      channel: input.provider,
      subject: input.subject.trim() || "Customer conversation",
      message: input.body,
    });
    bindCustomerChannelThread({
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      conversationId: created.conversation.id,
      accessTokenHash: null,
      replyTo: input.replyTo ?? null,
      metadata: input.metadata ?? {},
    });
    return { duplicate: false, conversationId: created.conversation.id, message: created.message };
  }

  if (input.replyTo || input.metadata) {
    bindCustomerChannelThread({
      ...thread,
      replyTo: input.replyTo ?? thread.replyTo,
      metadata: { ...thread.metadata, ...input.metadata },
    });
  }
  const message = createCustomerMessage({
    conversationId: thread.conversationId,
    direction: "inbound",
    sender: "customer",
    body: input.body,
  });
  return { duplicate: false, conversationId: thread.conversationId, message };
}

export function createWebsiteConversation(input: {
  customerName: string;
  customerEmail?: string;
  subject?: string;
  body: string;
}): { conversationId: string; token: string; message: CustomerMessageRecord } {
  const token = randomBytes(32).toString("base64url");
  const externalThreadId = randomUUID();
  const created = createCustomerConversation({
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    channel: "website",
    subject: input.subject?.trim() || "Website chat",
    message: input.body,
  });
  bindCustomerChannelThread({
    provider: "website",
    externalThreadId,
    conversationId: created.conversation.id,
    accessTokenHash: sha256(token),
    replyTo: null,
    metadata: {},
  });
  return { conversationId: created.conversation.id, token, message: created.message };
}

export function authorizeWebsiteConversation(conversationId: string, token: string): boolean {
  const thread = getConversationChannelThread(conversationId);
  return Boolean(
    thread?.provider === "website" &&
    thread.accessTokenHash &&
    safeSecretEqual(thread.accessTokenHash, sha256(token))
  );
}

async function deliverExternal(channel: CustomerChannel, conversationId: string, body: string): Promise<string | undefined> {
  const thread = getConversationChannelThread(conversationId);
  if (!thread) throw new Error(`No ${channel} delivery thread is attached to this conversation.`);
  const platformId = channel === "email" ? "resend" : channel;
  if (getConnection(platformId)?.status !== "connected") {
    throw new Error(`${platformId} is not connected and verified on the Connections page.`);
  }
  const creds = getConnectionCredentials(platformId);
  if (!creds) throw new Error(`${platformId} credentials are unavailable.`);

  if (channel === "email") {
    if (!thread.replyTo) throw new Error("This email conversation has no reply address.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: creds.fromAddress,
        to: [thread.replyTo],
        subject: String(thread.metadata.subject ?? "Customer reply").replace(/^(?!Re:)/i, "Re: "),
        text: body,
        ...(thread.metadata.messageId ? { headers: { "In-Reply-To": String(thread.metadata.messageId) } } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Resend refused the reply (HTTP ${response.status}): ${text}`);
    return (JSON.parse(text) as { id?: string }).id;
  }

  if (channel === "x") {
    const url = `https://api.x.com/2/dm_conversations/with/${encodeURIComponent(thread.externalThreadId)}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: oauth1Header("POST", url, {
          apiKey: creds.apiKey, apiSecret: creds.apiSecret,
          accessToken: creds.accessToken, accessTokenSecret: creds.accessTokenSecret,
        }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: body }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`X refused the direct message (HTTP ${response.status}): ${text}`);
    return (JSON.parse(text) as { data?: { dm_event_id?: string } }).data?.dm_event_id;
  }

  const graphVersion = "v24.0";
  const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(creds.accountId)}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: thread.externalThreadId }, messaging_type: "RESPONSE", message: { text: body } }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${channel} refused the message (HTTP ${response.status}): ${text}`);
  return (JSON.parse(text) as { message_id?: string }).message_id;
}

export async function sendCustomerReply(input: {
  conversationId: string;
  channel: CustomerChannel;
  body: string;
  sender: "jarvis" | "operator";
  draftId?: string;
}): Promise<CustomerMessageRecord> {
  let externalId: string | undefined;
  if (input.channel !== "website") externalId = await deliverExternal(input.channel, input.conversationId, input.body);
  const message = createCustomerMessage({
    conversationId: input.conversationId,
    direction: "outbound",
    sender: input.sender,
    body: input.body,
  });
  recordCustomerMessageDelivery({
    messageId: message.id,
    provider: input.channel,
    status: input.channel === "website" ? "recorded" : "sent",
    externalId,
  });
  return message;
}
