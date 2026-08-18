import { createHmac } from "node:crypto";
import { Webhook } from "svix";
import type { CustomerChannel } from "@jarvis/shared";
import { handleCustomerInbound } from "./customerService.js";
import { ingestCustomerMessage, safeSecretEqual } from "./channelGateway.js";

function hmac(secret: string, raw: Buffer): string {
  return createHmac("sha256", secret).update(raw).digest("base64");
}

export function xCrcResponse(secret: string, token: string): string {
  return `sha256=${createHmac("sha256", secret).update(token).digest("base64")}`;
}

export function verifyXWebhook(secret: string, raw: Buffer, signature: string): boolean {
  return safeSecretEqual(`sha256=${hmac(secret, raw)}`, signature);
}

export function verifyMetaWebhook(secret: string, raw: Buffer, signature: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return safeSecretEqual(expected, signature);
}

function nameAndEmail(value: string): { name: string; email: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const email = (match?.[2] ?? value).trim();
  return { name: match?.[1]?.replace(/^['"]|['"]$/g, "").trim() || email.split("@")[0] || "Customer", email };
}

export async function handleResendWebhook(raw: Buffer, headers: Record<string, string>, creds: Record<string, string>): Promise<boolean> {
  const event = new Webhook(creds.webhookSecret).verify(raw.toString("utf8"), headers) as {
    type?: string;
    data?: { email_id?: string };
  };
  if (event.type !== "email.received" || !event.data?.email_id) return false;
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(event.data.email_id)}`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not retrieve received email (HTTP ${response.status}): ${text}`);
  const email = JSON.parse(text) as {
    from?: string;
    subject?: string;
    text?: string;
    html?: string;
    message_id?: string;
  };
  const sender = nameAndEmail(email.from ?? "Customer");
  const body = (email.text || email.html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") || "").trim();
  if (!body) return false;
  const ingested = ingestCustomerMessage({
    provider: "email",
    eventId: headers["svix-id"] || event.data.email_id,
    externalThreadId: sender.email.toLowerCase(),
    customerName: sender.name,
    customerEmail: sender.email,
    subject: email.subject || "Email conversation",
    body,
    replyTo: sender.email,
    metadata: { subject: email.subject, messageId: email.message_id },
  });
  if (!ingested.duplicate && ingested.conversationId) handleCustomerInbound(ingested.conversationId, body);
  return !ingested.duplicate;
}

export function handleXWebhook(raw: Buffer, creds: Record<string, string>): number {
  const payload = JSON.parse(raw.toString("utf8")) as {
    for_user_id?: string;
    direct_message_events?: Array<{ id?: string; sender_id?: string; recipient_id?: string; text?: string; message_create?: { sender_id?: string; target?: { recipient_id?: string }; message_data?: { text?: string } } }>;
  };
  let count = 0;
  for (const event of payload.direct_message_events ?? []) {
    const sender = event.sender_id ?? event.message_create?.sender_id;
    const recipient = event.recipient_id ?? event.message_create?.target?.recipient_id;
    const body = event.text ?? event.message_create?.message_data?.text;
    if (!sender || !body || sender === payload.for_user_id) continue;
    const participant = sender === payload.for_user_id ? recipient : sender;
    if (!participant) continue;
    const ingested = ingestCustomerMessage({
      provider: "x",
      eventId: event.id ?? `${participant}:${Date.now()}:${body}`,
      externalThreadId: participant,
      customerName: `X customer ${participant}`,
      subject: "X direct message",
      body,
      metadata: { recipientId: recipient },
    });
    if (!ingested.duplicate && ingested.conversationId) {
      count += 1;
      handleCustomerInbound(ingested.conversationId, body);
    }
  }
  return count;
}

export function handleMetaWebhook(raw: Buffer, channel: Extract<CustomerChannel, "facebook" | "instagram">): number {
  const payload = JSON.parse(raw.toString("utf8")) as {
    entry?: Array<{ messaging?: Array<{ sender?: { id?: string }; recipient?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean } }> }>;
  };
  let count = 0;
  for (const entry of payload.entry ?? []) for (const event of entry.messaging ?? []) {
    const sender = event.sender?.id;
    const body = event.message?.text;
    if (!sender || !body || event.message?.is_echo) continue;
    const ingested = ingestCustomerMessage({
      provider: channel,
      eventId: event.message?.mid ?? `${sender}:${Date.now()}:${body}`,
      externalThreadId: sender,
      customerName: `${channel === "facebook" ? "Facebook" : "Instagram"} customer ${sender}`,
      subject: `${channel === "facebook" ? "Facebook" : "Instagram"} message`,
      body,
      metadata: { recipientId: event.recipient?.id },
    });
    if (!ingested.duplicate && ingested.conversationId) {
      count += 1;
      handleCustomerInbound(ingested.conversationId, body);
    }
  }
  return count;
}
