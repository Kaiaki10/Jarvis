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

export interface ResendInboundEmail {
  sender: { name: string; email: string };
  /** Recipient addresses, lowercased. Resend delivers every inbound address on the connected domain to this one webhook, so callers route on this rather than needing a second endpoint. */
  recipients: string[];
  subject: string;
  body: string;
  messageId?: string;
  /** Stable id for dedup — the Svix delivery id when present, else Resend's own email id. */
  eventId: string;
}

function normalizeRecipients(to: unknown): string[] {
  if (!Array.isArray(to)) return [];
  return to
    .map((entry) => (typeof entry === "string" ? entry : (entry as { email?: string })?.email))
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => nameAndEmail(value).email.toLowerCase());
}

/**
 * Verifies a Resend "email.received" webhook and fetches+parses the full
 * message. Shared by the customer-support inbound path (`handleResendWebhook`
 * below) and the signup-confirmation path (`platforms/signupInbox.ts`) — both
 * arrive at the same webhook URL, since Resend has one inbound endpoint per
 * connected domain regardless of which address on it received the mail.
 *
 * Returns null for a webhook event that isn't a received email (not an
 * error — Resend's webhook can carry other event types on the same URL).
 */
export async function verifyAndFetchResendEmail(
  raw: Buffer,
  headers: Record<string, string>,
  creds: Record<string, string>
): Promise<ResendInboundEmail | null> {
  const event = new Webhook(creds.webhookSecret).verify(raw.toString("utf8"), headers) as {
    type?: string;
    data?: { email_id?: string };
  };
  if (event.type !== "email.received" || !event.data?.email_id) return null;
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(event.data.email_id)}`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not retrieve received email (HTTP ${response.status}): ${text}`);
  const email = JSON.parse(text) as {
    from?: string;
    to?: unknown;
    subject?: string;
    text?: string;
    html?: string;
    message_id?: string;
  };
  return {
    sender: nameAndEmail(email.from ?? "Unknown sender"),
    recipients: normalizeRecipients(email.to),
    subject: email.subject || "",
    body: (email.text || email.html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") || "").trim(),
    messageId: email.message_id,
    eventId: headers["svix-id"] || event.data.email_id,
  };
}

/**
 * The customer-support half of Resend inbound handling, operating on an
 * already verified+fetched email — split out from the webhook verification
 * itself so the route can decide, per email, whether it's a platform
 * signup confirmation (`platforms/signupInbox.ts`) instead of a customer
 * message, without fetching the same email from Resend's API twice.
 */
export function ingestResendCustomerEmail(email: ResendInboundEmail): boolean {
  if (!email.body) return false;
  const ingested = ingestCustomerMessage({
    provider: "email",
    eventId: email.eventId,
    externalThreadId: email.sender.email.toLowerCase(),
    customerName: email.sender.name,
    customerEmail: email.sender.email,
    subject: email.subject || "Email conversation",
    body: email.body,
    replyTo: email.sender.email,
    metadata: { subject: email.subject, messageId: email.messageId },
  });
  if (!ingested.duplicate && ingested.conversationId) handleCustomerInbound(ingested.conversationId, email.body);
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
