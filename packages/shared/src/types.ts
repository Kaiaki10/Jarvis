export type AgentStatus = "active" | "archived";

/**
 * An agent's identity. Before v2 every field here was a global `settings` row,
 * which is why there could only ever be one.
 */
export interface AgentRecord {
  id: string;
  name: string;
  role: string;
  /** Appended to the system prompt of every run this agent owns. */
  systemPrompt: string;
  cwd: string;
  avatar: string;
  color: string;
  permissionMode: string;
  allowedTools: string[] | null;
  /** The agent's one ongoing conversation, continued rather than restarted. */
  chatSessionId: string | null;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  role?: string;
  systemPrompt?: string;
  cwd?: string;
  avatar?: string;
  color?: string;
  permissionMode?: string;
  allowedTools?: string[];
}

export interface UpdateAgentRequest {
  name?: string;
  role?: string;
  systemPrompt?: string;
  cwd?: string;
  avatar?: string;
  color?: string;
  permissionMode?: string;
  allowedTools?: string[] | null;
  status?: AgentStatus;
}

export type SessionStatus =
  | "starting"
  | "running"
  | "waiting_permission"
  | "idle"
  | "completed"
  | "error"
  | "stopped"
  | "interrupted";

/** Models available in the focused, simple Jarvis conversation. */
export type ChatModel = "claude" | "gpt-5.6-sol";

export interface SessionRecord {
  id: string;
  /** Which agent owns this. Null only for rows that predate the agent migration. */
  agentId: string | null;
  claudeSessionId: string | null;
  codexThreadId: string | null;
  model: ChatModel;
  title: string;
  status: SessionStatus;
  cwd: string;
  permissionMode: string;
  allowedTools: string[] | null;
  taskId: string | null;
  costUsd: number | null;
  turns: number | null;
  /** The run's own one-line account of what it did, from its final message. */
  summary: string | null;
  /** What it is doing right now, while running. */
  currentActivity: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SessionEventType =
  | "assistant"
  | "user"
  | "stream_event"
  | "result"
  | "system"
  | "tool_progress"
  | "auth_status"
  | "permission_request"
  | "permission_response";

export interface SessionEventRecord {
  id: number;
  sessionId: string;
  seq: number;
  type: SessionEventType;
  payload: unknown;
  createdAt: string;
}

export type MemoryKind = "preference" | "business" | "relationship" | "decision" | "fact";
export type MemoryStatus = "active" | "archived";

export interface MemoryRecord {
  id: string;
  /** Null means the shared pool that every agent reads. */
  agentId: string | null;
  kind: MemoryKind;
  content: string;
  sourceSessionId: string | null;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export type MemoryReflectionStatus = "reviewed" | "failed" | "skipped";

export interface MemoryReflectionRecord {
  id: string;
  sessionId: string;
  sessionTitle: string;
  status: MemoryReflectionStatus;
  memoriesAdded: number;
  memoriesConfirmed: number;
  createdAt: string;
}

export interface CreateMemoryRequest {
  kind: MemoryKind;
  content: string;
  /** True stores it in the shared pool instead of the active agent. */
  shared?: boolean;
}

export interface UpdateMemoryRequest {
  kind?: MemoryKind;
  content?: string;
  status?: MemoryStatus;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export interface TaskRecord {
  id: string;
  agentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  sessionId: string | null;
  missionId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type MissionStatus = "planned" | "active" | "blocked" | "completed" | "archived";

export interface MissionRecord {
  id: string;
  agentId: string | null;
  title: string;
  outcome: string;
  status: MissionStatus;
  targetDate: string | null;
  nextAction: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type DeliverableStatus = "draft" | "ready" | "approved";

export interface DeliverableRecord {
  id: string;
  missionId: string;
  title: string;
  description: string | null;
  uri: string | null;
  status: DeliverableStatus;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MissionUpdateStatus = "proposed" | "applied" | "dismissed";

export interface MissionUpdateRecord {
  id: string;
  missionId: string;
  sessionId: string;
  taskId: string | null;
  summary: string;
  proposedNextAction: string | null;
  blocker: string | null;
  artifactCount: number;
  status: MissionUpdateStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface CreateMissionRequest {
  title: string;
  outcome: string;
  targetDate?: string;
}

export interface UpdateMissionRequest {
  title?: string;
  outcome?: string;
  status?: MissionStatus;
  targetDate?: string | null;
  nextAction?: string | null;
}

export interface CreateDeliverableRequest {
  title: string;
  description?: string;
  uri?: string;
  sessionId?: string;
}

export interface CreateSessionRequest {
  prompt: string;
  cwd: string;
  permissionMode?: string;
  allowedTools?: string[];
  taskId?: string;
}

export interface PermissionResponseRequest {
  requestId: string;
  decision: "allow" | "deny";
  updatedInput?: unknown;
}

export interface CredentialFieldDefinition {
  key: string;
  label: string;
  help: string;
  placeholder?: string;
  /** Masked in the UI and never returned by the API once saved. */
  secret: boolean;
  optional?: boolean;
  /** Rejected at save time if the value doesn't start with this, to catch mispastes. */
  expectedPrefix?: string;
}

export interface SetupStepDefinition {
  title: string;
  body: string[];
  linkUrl?: string;
  linkLabel?: string;
  /** Called out in the UI as an easy-to-miss gotcha. */
  warning?: string;
}

export interface PlatformDefinition {
  id: string;
  name: string;
  tagline: string;
  category: "social" | "messaging" | "email" | "advertising";
  docsUrl: string;
  steps: SetupStepDefinition[];
  fields: CredentialFieldDefinition[];
  /** Human-readable abilities used by the UI; definitions stay extensible as integrations grow. */
  capabilities?: string[];
  /** Expected reporting cadence or window, shown without implying fresher data than the API provides. */
  dataFreshness?: string;
}

export type ConnectionStatus = "not_connected" | "connected" | "error";

export interface ConnectionRecord {
  platformId: string;
  status: ConnectionStatus;
  /** Human-readable proof of who we connected as, e.g. "Connected as @acme". */
  detail: string | null;
  errorMessage: string | null;
  /** Masked previews only — real values never leave the orchestrator. */
  fieldHints: Record<string, string>;
  lastTestedAt: string | null;
  updatedAt: string;
}

export interface SaveConnectionRequest {
  values: Record<string, string>;
}

export interface TestConnectionResult {
  ok: boolean;
  detail?: string;
  message?: string;
}

export type NotificationType =
  | "approval_needed"
  | "session_failed"
  | "automation_failed"
  | "customer_escalation"
  | "paid_growth_approval";

export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationRecord {
  id: string;
  agentId: string | null;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  sessionId: string | null;
  read: boolean;
  createdAt: string;
}

export interface SettingsRecord {
  /** Durable business context appended to every session's system prompt. */
  businessContext: string;
  /** Global kill switch for all scheduled automations. */
  automationsEnabled: boolean;
  /** Guardrail against burning through subscription rate limits. */
  maxConcurrentSessions: number;
  /** Windows toast when something needs a human. Requires a signed-in desktop. */
  notifyOnDesktop: boolean;
  /** Where to email alerts. Only used once an email platform is connected. */
  notifyEmail: string;
  /** Auto-deny an unanswered approval after this many minutes. 0 waits forever. */
  approvalTimeoutMinutes: number;
  /** Drop session transcripts older than this many days. 0 keeps everything. */
  eventRetentionDays: number;
  /** Max billable actions per platform per day. 0 disables the guardrail. */
  dailyPlatformActionCap: number;
  /** Folder Jarvis reads images from when attaching them to posts. */
  imagesFolder: string;
  /** Where the ongoing conversation with Jarvis runs. */
  chatWorkingDirectory: string;
}

export interface PlatformUsage {
  platformId: string;
  usedToday: number;
  cap: number;
  estimatedSpendToday: number;
}

export interface StorageStats {
  dbBytes: number;
  totalEvents: number;
  streamEvents: number;
  compactableEvents: number;
  sessions: number;
}

export interface MaintenanceResult {
  compacted: number;
  pruned: number;
  reclaimedBytes: number;
}

export interface UpdateSettingsRequest {
  businessContext?: string;
  automationsEnabled?: boolean;
  maxConcurrentSessions?: number;
  notifyOnDesktop?: boolean;
  notifyEmail?: string;
  approvalTimeoutMinutes?: number;
  eventRetentionDays?: number;
  dailyPlatformActionCap?: number;
  imagesFolder?: string;
  chatWorkingDirectory?: string;
}

export interface ScheduledTaskRecord {
  id: string;
  agentId: string | null;
  prompt: string;
  cwd: string;
  permissionMode: string;
  allowedTools: string[] | null;
  /** 24h local time, "HH:MM" */
  timeOfDay: string;
  /** 0=Sunday..6=Saturday */
  daysOfWeek: number[];
  enabled: boolean;
  lastRunAt: string | null;
  lastSessionId: string | null;
  nextRunAt: string | null;
  /** Consecutive retries for the current scheduled occurrence. */
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTaskRequest {
  prompt: string;
  cwd: string;
  permissionMode?: string;
  allowedTools?: string[];
  timeOfDay: string;
  daysOfWeek: number[];
}

export interface UpdateScheduledTaskRequest {
  prompt?: string;
  cwd?: string;
  permissionMode?: string;
  allowedTools?: string[];
  timeOfDay?: string;
  daysOfWeek?: number[];
  enabled?: boolean;
}

export interface AutomationRehearsal {
  taskId: string;
  nextRuns: string[];
  checks: Array<{ label: string; ok: boolean; detail: string }>;
  approvalRequired: boolean;
}

export type EvolutionStage =
  | "observed"
  | "planned"
  | "building"
  | "review"
  | "promoted"
  | "rolled_back";

export type EvolutionRisk = "low" | "medium" | "high" | "critical";
export type EvolutionChangeClass = "knowledge" | "behavior" | "capability" | "product" | "security";
export type EvolutionAutonomy = "automatic" | "after_checks" | "approval_required";

export interface EvolutionProposalRecord {
  id: string;
  agentId: string | null;
  title: string;
  problem: string;
  expectedValue: string;
  changeClass: EvolutionChangeClass;
  risk: EvolutionRisk;
  stage: EvolutionStage;
  evidence: string | null;
  rollbackPlan: string | null;
  labSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
}

export interface EvolutionPolicyRecord {
  changeClass: EvolutionChangeClass;
  autonomy: EvolutionAutonomy;
  updatedAt: string | null;
}

export interface EvolutionReadiness {
  labAvailable: boolean;
  labPath: string;
  labBranch: string | null;
  promotionEngineReady: boolean;
  automaticRollbackReady: boolean;
}

export interface EvolutionOverview {
  proposals: EvolutionProposalRecord[];
  policies: EvolutionPolicyRecord[];
  readiness: EvolutionReadiness;
}

export interface CreateEvolutionProposalRequest {
  title: string;
  problem: string;
  expectedValue: string;
  changeClass: EvolutionChangeClass;
  risk: EvolutionRisk;
  evidence?: string;
  rollbackPlan?: string;
}

export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type CampaignApprovalPolicy = "each_item" | "campaign";
export type MarketingChannel = "x" | "linkedin" | "instagram" | "facebook" | "email" | "blog";
export type ContentFormat = "social_post" | "email" | "article" | "ad";
export type ContentStatus = "idea" | "draft" | "review" | "scheduled" | "published" | "measured";
export type CampaignGenerationStatus = "running" | "completed" | "failed";
export type ContentPublicationStatus = "running" | "published" | "failed";

export interface CampaignRecord {
  id: string;
  agentId: string | null;
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: MarketingChannel[];
  primaryMetric: string;
  approvalPolicy: CampaignApprovalPolicy;
  status: CampaignStatus;
  missionId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ContentItemRecord {
  id: string;
  campaignId: string;
  title: string;
  body: string;
  format: ContentFormat;
  channel: MarketingChannel;
  status: ContentStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  performanceSummary: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignGenerationRunRecord {
  id: string;
  campaignId: string;
  sessionId: string;
  status: CampaignGenerationStatus;
  requestedCount: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ContentPublicationRunRecord {
  id: string;
  contentItemId: string;
  sessionId: string;
  platformId: string;
  status: ContentPublicationStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CampaignOverview {
  campaigns: CampaignRecord[];
  content: ContentItemRecord[];
  generationRuns: CampaignGenerationRunRecord[];
  publicationRuns: ContentPublicationRunRecord[];
}

export interface CreateCampaignRequest {
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: MarketingChannel[];
  primaryMetric: string;
  approvalPolicy?: CampaignApprovalPolicy;
  missionId?: string;
}

export interface UpdateCampaignRequest {
  name?: string;
  objective?: string;
  audience?: string;
  offer?: string;
  channels?: MarketingChannel[];
  primaryMetric?: string;
  approvalPolicy?: CampaignApprovalPolicy;
  status?: CampaignStatus;
  missionId?: string | null;
}

export interface CreateContentItemRequest {
  title: string;
  body: string;
  format: ContentFormat;
  channel: MarketingChannel;
  status?: Extract<ContentStatus, "idea" | "draft">;
}

export interface UpdateContentItemRequest {
  title?: string;
  body?: string;
  format?: ContentFormat;
  channel?: MarketingChannel;
  status?: ContentStatus;
  scheduledFor?: string | null;
  performanceSummary?: string | null;
}

export interface GenerateCampaignContentRequest {
  count: number;
  formats: ContentFormat[];
  channels?: MarketingChannel[];
  direction?: string;
}

export type PaidMediaPlatform = "google_ads" | "meta_ads" | "x_ads";
export type PaidGrowthStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "active"
  | "paused"
  | "completed";
export type PaidGrowthDecisionKind = "launch" | "increase_budget" | "pause" | "reallocate";
export type PaidGrowthDecisionStatus = "proposed" | "approved" | "rejected" | "applied";

export interface PaidGrowthCampaignRecord {
  id: string;
  agentId: string | null;
  campaignId: string | null;
  name: string;
  objective: string;
  platform: PaidMediaPlatform;
  externalCampaignId: string | null;
  /** Optional budget-owning entity, primarily a Meta ad set when campaign budget optimization is off. */
  externalBudgetEntityId: string | null;
  status: PaidGrowthStatus;
  currency: string;
  dailyBudgetMinor: number;
  lifetimeBudgetMinor: number;
  approvedBudgetMinor: number;
  spentMinor: number;
  revenueMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
  targetRoas: number | null;
  startDate: string;
  endDate: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaidGrowthDecisionRecord {
  id: string;
  paidCampaignId: string;
  kind: PaidGrowthDecisionKind;
  status: PaidGrowthDecisionStatus;
  reason: string;
  proposedDailyBudgetMinor: number | null;
  sourcePaidCampaignId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface PaidGrowthMetrics {
  ctr: number | null;
  cpcMinor: number | null;
  costPerConversionMinor: number | null;
  roas: number | null;
  budgetUtilization: number;
}

export interface PaidGrowthCampaignView extends PaidGrowthCampaignRecord {
  metrics: PaidGrowthMetrics;
  connectionReady: boolean;
}

export interface PaidGrowthOverview {
  campaigns: PaidGrowthCampaignView[];
  decisions: PaidGrowthDecisionRecord[];
  totals: {
    currency: string | null;
    approvedBudgetMinor: number;
    spentMinor: number;
    revenueMinor: number;
    active: number;
    waitingApproval: number;
  };
}

export interface CreatePaidGrowthCampaignRequest {
  campaignId?: string;
  name: string;
  objective: string;
  platform: PaidMediaPlatform;
  externalCampaignId?: string;
  externalBudgetEntityId?: string;
  currency: string;
  dailyBudgetMinor: number;
  lifetimeBudgetMinor: number;
  targetRoas?: number;
  startDate: string;
  endDate?: string;
}

export interface UpdatePaidGrowthCampaignRequest {
  name?: string;
  objective?: string;
  externalCampaignId?: string | null;
  externalBudgetEntityId?: string | null;
  dailyBudgetMinor?: number;
  lifetimeBudgetMinor?: number;
  targetRoas?: number | null;
  startDate?: string;
  endDate?: string | null;
  status?: Extract<PaidGrowthStatus, "draft" | "paused" | "completed">;
}

export interface UpdatePaidGrowthPerformanceRequest {
  spentMinor: number;
  revenueMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export type CustomerChannel = "website" | "email" | "x" | "instagram" | "facebook";
export type CustomerConversationStatus = "open" | "waiting" | "resolved";
export type CustomerPriority = "low" | "normal" | "high" | "urgent";
export type CustomerSentiment = "positive" | "neutral" | "negative";
export type CustomerAssignee = "jarvis" | "human";
export type CustomerMessageDirection = "inbound" | "outbound" | "internal";
export type CustomerMessageSender = "customer" | "jarvis" | "operator" | "system";
export type CustomerReplyDraftStatus = "running" | "ready" | "used" | "failed";

export interface CustomerRecord {
  id: string;
  agentId: string | null;
  name: string;
  email: string | null;
  company: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerConversationRecord {
  id: string;
  customerId: string;
  channel: CustomerChannel;
  subject: string;
  status: CustomerConversationStatus;
  priority: CustomerPriority;
  sentiment: CustomerSentiment;
  assignedTo: CustomerAssignee;
  summary: string | null;
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMessageRecord {
  id: string;
  conversationId: string;
  direction: CustomerMessageDirection;
  sender: CustomerMessageSender;
  body: string;
  createdAt: string;
}

export interface CustomerReplyDraftRecord {
  id: string;
  conversationId: string;
  sessionId: string;
  status: CustomerReplyDraftStatus;
  body: string | null;
  errorMessage: string | null;
  confidence: number | null;
  requiresApproval: boolean;
  escalationReason: string | null;
  autoSend: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CustomerDeliveryStatus = "recorded" | "sent" | "failed";

export interface CustomerMessageDeliveryRecord {
  messageId: string;
  provider: CustomerChannel;
  status: CustomerDeliveryStatus;
  externalId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerServicePolicyRecord {
  enabled: boolean;
  autoReplyWebsite: boolean;
  autoReplyEmail: boolean;
  autoReplySocial: boolean;
  confidenceThreshold: number;
  maxAutoRepliesPerConversation: number;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: number[];
  escalationKeywords: string[];
  widgetName: string;
  widgetWelcome: string;
  allowedOrigins: string[];
  updatedAt: string | null;
}

export interface CustomerOperationsOverview {
  customers: CustomerRecord[];
  conversations: CustomerConversationRecord[];
  messages: CustomerMessageRecord[];
  drafts: CustomerReplyDraftRecord[];
  deliveries: CustomerMessageDeliveryRecord[];
  policy: CustomerServicePolicyRecord;
}

export interface UpdateCustomerServicePolicyRequest {
  enabled?: boolean;
  autoReplyWebsite?: boolean;
  autoReplyEmail?: boolean;
  autoReplySocial?: boolean;
  confidenceThreshold?: number;
  maxAutoRepliesPerConversation?: number;
  businessHoursStart?: string;
  businessHoursEnd?: string;
  businessDays?: number[];
  escalationKeywords?: string[];
  widgetName?: string;
  widgetWelcome?: string;
  allowedOrigins?: string[];
}

export interface CreateCustomerConversationRequest {
  customerName: string;
  customerEmail?: string;
  company?: string;
  channel: CustomerChannel;
  subject: string;
  message: string;
  priority?: CustomerPriority;
}

export interface UpdateCustomerConversationRequest {
  status?: CustomerConversationStatus;
  priority?: CustomerPriority;
  sentiment?: CustomerSentiment;
  assignedTo?: CustomerAssignee;
  summary?: string | null;
  unreadCount?: number;
}

export interface CreateCustomerMessageRequest {
  body: string;
  sender?: Extract<CustomerMessageSender, "jarvis" | "operator">;
  draftId?: string;
}

export interface UpdateCustomerRequest {
  name?: string;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
}

export type AgentConversationStatus =
  | "idle"
  | "running"
  | "completed"
  | "stopped"
  | "error";

/**
 * A room where two or more agents talk to each other.
 *
 * The caps live on the record rather than in config: two agents talking is an
 * infinite generator running unattended, and a room carries its own limits so
 * changing a default can never unbound a room already in flight.
 */
export interface AgentConversationRecord {
  id: string;
  title: string;
  topic: string;
  status: AgentConversationStatus;
  turnCap: number;
  budgetSeconds: number;
  turnsUsed: number;
  startedAt: string | null;
  endedAt: string | null;
  /** Why it ended, in words, so a finished room explains itself. */
  stopReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConversationParticipantRecord {
  conversationId: string;
  agentId: string;
  /** The session carrying this agent's side of the room. */
  sessionId: string | null;
  position: number;
  name: string;
  avatar: string;
}

export interface AgentConversationMessageRecord {
  id: string;
  conversationId: string;
  turn: number;
  /** Null means the human interjected. */
  speakerAgentId: string | null;
  speakerName: string;
  body: string;
  createdAt: string;
}

export interface CreateAgentConversationRequest {
  title: string;
  topic: string;
  agentIds: string[];
  turnCap?: number;
  budgetSeconds?: number;
}

export interface AgentConversationDetail {
  conversation: AgentConversationRecord;
  participants: AgentConversationParticipantRecord[];
  messages: AgentConversationMessageRecord[];
}
