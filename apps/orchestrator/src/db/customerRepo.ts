import { randomUUID } from "node:crypto";
import type {
  CreateCustomerConversationRequest,
  CustomerAssignee,
  CustomerChannel,
  CustomerConversationRecord,
  CustomerConversationStatus,
  CustomerMessageDirection,
  CustomerMessageRecord,
  CustomerMessageSender,
  CustomerOperationsOverview,
  CustomerPriority,
  CustomerRecord,
  CustomerReplyDraftRecord,
  CustomerReplyDraftStatus,
  CustomerSentiment,
  CustomerMessageDeliveryRecord,
  CustomerDeliveryStatus,
  CustomerServicePolicyRecord,
  UpdateCustomerServicePolicyRequest,
  UpdateCustomerConversationRequest,
  UpdateCustomerRequest,
} from "@jarvis/shared";
import { db } from "./db.js";

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  customer_id: string;
  channel: string;
  subject: string;
  status: string;
  priority: string;
  sentiment: string;
  assigned_to: string;
  summary: string | null;
  unread_count: number;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  sender: string;
  body: string;
  created_at: string;
}

interface DraftRow {
  id: string;
  conversation_id: string;
  session_id: string;
  status: string;
  body: string | null;
  error_message: string | null;
  confidence: number | null;
  requires_approval: number;
  escalation_reason: string | null;
  auto_send: number;
  created_at: string;
  updated_at: string;
}

interface DeliveryRow {
  message_id: string;
  provider: string;
  status: string;
  external_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerChannelThread {
  provider: CustomerChannel;
  externalThreadId: string;
  conversationId: string;
  accessTokenHash: string | null;
  replyTo: string | null;
  metadata: Record<string, unknown>;
}

function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversation(row: ConversationRow): CustomerConversationRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    channel: row.channel as CustomerChannel,
    subject: row.subject,
    status: row.status as CustomerConversationStatus,
    priority: row.priority as CustomerPriority,
    sentiment: row.sentiment as CustomerSentiment,
    assignedTo: row.assigned_to as CustomerAssignee,
    summary: row.summary,
    unreadCount: row.unread_count,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): CustomerMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction as CustomerMessageDirection,
    sender: row.sender as CustomerMessageSender,
    body: row.body,
    createdAt: row.created_at,
  };
}

function mapDraft(row: DraftRow): CustomerReplyDraftRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    status: row.status as CustomerReplyDraftStatus,
    body: row.body,
    errorMessage: row.error_message,
    confidence: row.confidence,
    requiresApproval: row.requires_approval === 1,
    escalationReason: row.escalation_reason,
    autoSend: row.auto_send === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDelivery(row: DeliveryRow): CustomerMessageDeliveryRecord {
  return {
    messageId: row.message_id,
    provider: row.provider as CustomerChannel,
    status: row.status as CustomerDeliveryStatus,
    externalId: row.external_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DEFAULT_POLICY: CustomerServicePolicyRecord = {
  enabled: false,
  autoReplyWebsite: true,
  autoReplyEmail: false,
  autoReplySocial: false,
  confidenceThreshold: 0.9,
  maxAutoRepliesPerConversation: 3,
  businessHoursStart: "08:00",
  businessHoursEnd: "18:00",
  businessDays: [1, 2, 3, 4, 5],
  escalationKeywords: ["refund", "chargeback", "legal", "lawsuit", "threat", "fraud", "cancel"],
  widgetName: "Jarvis Support",
  widgetWelcome: "Hi — how can we help?",
  allowedOrigins: [],
  updatedAt: null,
};

export function getCustomerServicePolicy(): CustomerServicePolicyRecord {
  const row = db.prepare(`SELECT * FROM customer_service_policy WHERE singleton_id = 1`).get() as unknown as Record<string, unknown> | undefined;
  if (!row) return DEFAULT_POLICY;
  return {
    enabled: row.enabled === 1,
    autoReplyWebsite: row.auto_reply_website === 1,
    autoReplyEmail: row.auto_reply_email === 1,
    autoReplySocial: row.auto_reply_social === 1,
    confidenceThreshold: Number(row.confidence_threshold),
    maxAutoRepliesPerConversation: Number(row.max_auto_replies),
    businessHoursStart: String(row.business_hours_start),
    businessHoursEnd: String(row.business_hours_end),
    businessDays: JSON.parse(String(row.business_days)) as number[],
    escalationKeywords: JSON.parse(String(row.escalation_keywords)) as string[],
    widgetName: String(row.widget_name),
    widgetWelcome: String(row.widget_welcome),
    allowedOrigins: JSON.parse(String(row.allowed_origins)) as string[],
    updatedAt: String(row.updated_at),
  };
}

export function updateCustomerServicePolicy(patch: UpdateCustomerServicePolicyRequest): CustomerServicePolicyRecord {
  const current = getCustomerServicePolicy();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  db.prepare(
    `INSERT INTO customer_service_policy
      (singleton_id, enabled, auto_reply_website, auto_reply_email, auto_reply_social, confidence_threshold,
       max_auto_replies, business_hours_start, business_hours_end, business_days, escalation_keywords,
       widget_name, widget_welcome, allowed_origins, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(singleton_id) DO UPDATE SET
       enabled = excluded.enabled, auto_reply_website = excluded.auto_reply_website,
       auto_reply_email = excluded.auto_reply_email, auto_reply_social = excluded.auto_reply_social,
       confidence_threshold = excluded.confidence_threshold, max_auto_replies = excluded.max_auto_replies,
       business_hours_start = excluded.business_hours_start, business_hours_end = excluded.business_hours_end,
       business_days = excluded.business_days, escalation_keywords = excluded.escalation_keywords,
       widget_name = excluded.widget_name, widget_welcome = excluded.widget_welcome,
       allowed_origins = excluded.allowed_origins, updated_at = excluded.updated_at`
  ).run(
    next.enabled ? 1 : 0, next.autoReplyWebsite ? 1 : 0, next.autoReplyEmail ? 1 : 0,
    next.autoReplySocial ? 1 : 0, next.confidenceThreshold, next.maxAutoRepliesPerConversation,
    next.businessHoursStart, next.businessHoursEnd, JSON.stringify(next.businessDays),
    JSON.stringify(next.escalationKeywords), next.widgetName, next.widgetWelcome,
    JSON.stringify(next.allowedOrigins), next.updatedAt
  );
  return getCustomerServicePolicy();
}

export function listCustomerOperations(): CustomerOperationsOverview {
  const customers = db.prepare(`SELECT * FROM customers ORDER BY updated_at DESC`).all() as unknown as CustomerRow[];
  const conversations = db.prepare(
    `SELECT * FROM customer_conversations
     ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              last_message_at DESC`
  ).all() as unknown as ConversationRow[];
  const messages = db.prepare(`SELECT * FROM customer_messages ORDER BY created_at ASC`).all() as unknown as MessageRow[];
  const drafts = db.prepare(`SELECT * FROM customer_reply_drafts ORDER BY created_at DESC`).all() as unknown as DraftRow[];
  const deliveries = db.prepare(`SELECT * FROM customer_message_deliveries ORDER BY created_at DESC`).all() as unknown as DeliveryRow[];
  return {
    customers: customers.map(mapCustomer),
    conversations: conversations.map(mapConversation),
    messages: messages.map(mapMessage),
    drafts: drafts.map(mapDraft),
    deliveries: deliveries.map(mapDelivery),
    policy: getCustomerServicePolicy(),
  };
}

export function getCustomer(id: string): CustomerRecord | undefined {
  const row = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id) as unknown as CustomerRow | undefined;
  return row ? mapCustomer(row) : undefined;
}

export function getCustomerConversation(id: string): CustomerConversationRecord | undefined {
  const row = db.prepare(`SELECT * FROM customer_conversations WHERE id = ?`).get(id) as unknown as ConversationRow | undefined;
  return row ? mapConversation(row) : undefined;
}

export function listCustomerMessages(conversationId: string): CustomerMessageRecord[] {
  const rows = db.prepare(
    `SELECT * FROM customer_messages WHERE conversation_id = ? ORDER BY created_at ASC`
  ).all(conversationId) as unknown as MessageRow[];
  return rows.map(mapMessage);
}

function findOrCreateCustomer(input: Pick<CreateCustomerConversationRequest, "customerName" | "customerEmail" | "company">): CustomerRecord {
  const email = input.customerEmail?.trim() || null;
  if (email) {
    const existing = db.prepare(`SELECT * FROM customers WHERE lower(email) = lower(?) LIMIT 1`).get(email) as unknown as CustomerRow | undefined;
    if (existing) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE customers SET name = ?, company = COALESCE(?, company), updated_at = ? WHERE id = ?`)
        .run(input.customerName.trim(), input.company?.trim() || null, now, existing.id);
      return getCustomer(existing.id)!;
    }
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customers (id, name, email, company, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`
  ).run(id, input.customerName.trim(), email, input.company?.trim() || null, now, now);
  return getCustomer(id)!;
}

export function createCustomerConversation(input: CreateCustomerConversationRequest): {
  customer: CustomerRecord;
  conversation: CustomerConversationRecord;
  message: CustomerMessageRecord;
} {
  const customer = findOrCreateCustomer(input);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customer_conversations
      (id, customer_id, channel, subject, status, priority, sentiment, assigned_to, summary, unread_count, last_message_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, 'neutral', 'jarvis', NULL, 1, ?, ?, ?)`
  ).run(id, customer.id, input.channel, input.subject.trim(), input.priority ?? "normal", now, now, now);
  const message = createCustomerMessage({
    conversationId: id,
    direction: "inbound",
    sender: "customer",
    body: input.message,
    preserveInitialUnread: true,
  });
  return { customer, conversation: getCustomerConversation(id)!, message };
}

export function updateCustomerConversation(
  id: string,
  patch: UpdateCustomerConversationRequest
): CustomerConversationRecord | undefined {
  const current = getCustomerConversation(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE customer_conversations
     SET status = ?, priority = ?, sentiment = ?, assigned_to = ?, summary = ?, unread_count = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.status ?? current.status,
    patch.priority ?? current.priority,
    patch.sentiment ?? current.sentiment,
    patch.assignedTo ?? current.assignedTo,
    patch.summary !== undefined ? patch.summary : current.summary,
    patch.unreadCount ?? current.unreadCount,
    now,
    id
  );
  return getCustomerConversation(id);
}

export function deleteCustomerConversation(id: string): void {
  const conversation = getCustomerConversation(id);
  if (!conversation) return;
  db.prepare(`DELETE FROM customer_conversations WHERE id = ?`).run(id);
  const remaining = db.prepare(`SELECT COUNT(*) AS count FROM customer_conversations WHERE customer_id = ?`)
    .get(conversation.customerId) as unknown as { count: number };
  if (remaining.count === 0) db.prepare(`DELETE FROM customers WHERE id = ?`).run(conversation.customerId);
}

export function updateCustomer(id: string, patch: UpdateCustomerRequest): CustomerRecord | undefined {
  const current = getCustomer(id);
  if (!current) return undefined;
  db.prepare(
    `UPDATE customers SET name = ?, email = ?, company = ?, notes = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.name ?? current.name,
    patch.email !== undefined ? patch.email : current.email,
    patch.company !== undefined ? patch.company : current.company,
    patch.notes !== undefined ? patch.notes : current.notes,
    new Date().toISOString(),
    id
  );
  return getCustomer(id);
}

export function createCustomerMessage(input: {
  conversationId: string;
  direction: CustomerMessageDirection;
  sender: CustomerMessageSender;
  body: string;
  preserveInitialUnread?: boolean;
}): CustomerMessageRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customer_messages (id, conversation_id, direction, sender, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.conversationId, input.direction, input.sender, input.body.trim(), now);

  if (input.direction === "inbound") {
    db.prepare(
      `UPDATE customer_conversations
       SET status = 'open', unread_count = ?, last_message_at = ?, updated_at = ? WHERE id = ?`
    ).run(input.preserveInitialUnread ? 1 : (getCustomerConversation(input.conversationId)?.unreadCount ?? 0) + 1, now, now, input.conversationId);
  } else if (input.direction === "outbound") {
    db.prepare(
      `UPDATE customer_conversations
       SET status = 'waiting', unread_count = 0, last_message_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, input.conversationId);
  } else {
    db.prepare(`UPDATE customer_conversations SET updated_at = ? WHERE id = ?`).run(now, input.conversationId);
  }

  const row = db.prepare(`SELECT * FROM customer_messages WHERE id = ?`).get(id) as unknown as MessageRow;
  return mapMessage(row);
}

export function createCustomerReplyDraft(input: { conversationId: string; sessionId: string; autoSend?: boolean }): CustomerReplyDraftRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customer_reply_drafts
      (id, conversation_id, session_id, status, body, error_message, confidence, requires_approval, escalation_reason, auto_send, created_at, updated_at)
     VALUES (?, ?, ?, 'running', NULL, NULL, NULL, 1, NULL, ?, ?, ?)`
  ).run(id, input.conversationId, input.sessionId, input.autoSend ? 1 : 0, now, now);
  return getCustomerReplyDraftBySession(input.sessionId)!;
}

export function getCustomerReplyDraftBySession(sessionId: string): CustomerReplyDraftRecord | undefined {
  const row = db.prepare(`SELECT * FROM customer_reply_drafts WHERE session_id = ?`).get(sessionId) as unknown as DraftRow | undefined;
  return row ? mapDraft(row) : undefined;
}

export function finishCustomerReplyDraft(
  sessionId: string,
  status: Extract<CustomerReplyDraftStatus, "ready" | "failed">,
  body?: string,
  errorMessage?: string,
  review?: { confidence: number; requiresApproval: boolean; escalationReason?: string | null }
): CustomerReplyDraftRecord | undefined {
  db.prepare(
    `UPDATE customer_reply_drafts
     SET status = ?, body = ?, error_message = ?, confidence = ?, requires_approval = ?, escalation_reason = ?, updated_at = ?
     WHERE session_id = ?`
  ).run(
    status, body ?? null, errorMessage ?? null, review?.confidence ?? null,
    review?.requiresApproval === false ? 0 : 1, review?.escalationReason ?? null,
    new Date().toISOString(), sessionId
  );
  return getCustomerReplyDraftBySession(sessionId);
}

export function markCustomerReplyDraftUsed(id: string): void {
  db.prepare(`UPDATE customer_reply_drafts SET status = 'used', updated_at = ? WHERE id = ? AND status = 'ready'`)
    .run(new Date().toISOString(), id);
}

export function bindCustomerChannelThread(input: CustomerChannelThread): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customer_channel_threads
      (provider, external_thread_id, conversation_id, access_token_hash, reply_to, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, external_thread_id) DO UPDATE SET conversation_id = excluded.conversation_id,
       access_token_hash = excluded.access_token_hash, reply_to = excluded.reply_to,
       metadata = excluded.metadata, updated_at = excluded.updated_at`
  ).run(input.provider, input.externalThreadId, input.conversationId, input.accessTokenHash,
    input.replyTo, JSON.stringify(input.metadata), now, now);
}

function mapThread(row: Record<string, unknown>): CustomerChannelThread {
  return {
    provider: String(row.provider) as CustomerChannel,
    externalThreadId: String(row.external_thread_id),
    conversationId: String(row.conversation_id),
    accessTokenHash: row.access_token_hash ? String(row.access_token_hash) : null,
    replyTo: row.reply_to ? String(row.reply_to) : null,
    metadata: JSON.parse(String(row.metadata)) as Record<string, unknown>,
  };
}

export function getCustomerChannelThread(provider: CustomerChannel, externalThreadId: string): CustomerChannelThread | undefined {
  const row = db.prepare(`SELECT * FROM customer_channel_threads WHERE provider = ? AND external_thread_id = ?`)
    .get(provider, externalThreadId) as unknown as Record<string, unknown> | undefined;
  return row ? mapThread(row) : undefined;
}

export function getConversationChannelThread(conversationId: string): CustomerChannelThread | undefined {
  const row = db.prepare(`SELECT * FROM customer_channel_threads WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .get(conversationId) as unknown as Record<string, unknown> | undefined;
  return row ? mapThread(row) : undefined;
}

export function recordCustomerInboundEvent(provider: string, eventId: string, payloadHash: string): boolean {
  const result = db.prepare(
    `INSERT OR IGNORE INTO customer_inbound_events (provider, event_id, payload_hash, created_at) VALUES (?, ?, ?, ?)`
  ).run(provider, eventId, payloadHash, new Date().toISOString());
  return result.changes > 0;
}

export function recordCustomerMessageDelivery(input: {
  messageId: string;
  provider: CustomerChannel;
  status: CustomerDeliveryStatus;
  externalId?: string;
  errorMessage?: string;
}): CustomerMessageDeliveryRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customer_message_deliveries
      (message_id, provider, status, external_id, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET status = excluded.status, external_id = excluded.external_id,
       error_message = excluded.error_message, updated_at = excluded.updated_at`
  ).run(input.messageId, input.provider, input.status, input.externalId ?? null, input.errorMessage ?? null, now, now);
  return mapDelivery(db.prepare(`SELECT * FROM customer_message_deliveries WHERE message_id = ?`)
    .get(input.messageId) as unknown as DeliveryRow);
}

export function countAutomaticReplies(conversationId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM customer_reply_drafts WHERE conversation_id = ? AND auto_send = 1 AND status IN ('running', 'ready', 'used')`
  ).get(conversationId) as unknown as { count: number };
  return row.count;
}
