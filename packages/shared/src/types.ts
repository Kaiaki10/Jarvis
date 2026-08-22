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

/** Which underlying Claude model answers, when `model` is "claude". */
export type ClaudeModel = "default" | "opus" | "haiku" | "fable";

export const CLAUDE_MODELS: Array<{ value: ClaudeModel; label: string; description: string }> = [
  { value: "default", label: "Default", description: "Sonnet 5 · best for everyday tasks" },
  { value: "opus", label: "Opus", description: "Opus 5 · most capable for complex work" },
  { value: "haiku", label: "Haiku", description: "Haiku 4.5 · fastest for quick answers" },
  {
    value: "fable",
    label: "Fable",
    description: "Fable 5 · most capable for the hardest, longest-running tasks · draws on separate usage credits, not subscription usage",
  },
];

export interface SessionRecord {
  id: string;
  /** Which agent owns this. Null only for rows that predate the agent migration. */
  agentId: string | null;
  claudeSessionId: string | null;
  codexThreadId: string | null;
  model: ChatModel;
  /** Only meaningful when `model` is "claude"; ignored by the Codex lane. */
  claudeModel: ClaudeModel;
  /**
   * When true, Claude Code's own local tools (Bash, file edits, search, web
   * fetch) run without a permission prompt. Jarvis's own outbound platform
   * actions (posting, messaging, spending) are never affected by this — they
   * always go through the approval gate regardless.
   */
  autoApproveLocalTools: boolean;
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
  | "tool_use_summary"
  | "rate_limit_event"
  | "prompt_suggestion"
  | "conversation_reset"
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
  /**
   * What kind of human action this step actually requires, if any.
   * `"email_confirm"` is the only value Jarvis ever automates any part of —
   * it can detect the confirmation email arriving and surface its link
   * (never click it automatically unless the platform has opted in — see
   * `PlatformDefinition.autoFollowConfirmationLink`). `"captcha"` and
   * `"sms_otp"` are tagged specifically so no automation is ever attached to
   * them, by construction: platforms deliberately gate signup behind these to
   * stop exactly this kind of automation, and Jarvis does not attempt to get
   * around that. `"click"` (the default when unset) is an ordinary manual
   * step with no automatable signal at all.
   */
  humanAction?: "click" | "captcha" | "sms_otp" | "email_confirm";
}

export interface PlatformDefinition {
  id: string;
  name: string;
  tagline: string;
  category: "social" | "messaging" | "email" | "advertising" | "notifications" | "finance";
  docsUrl: string;
  steps: SetupStepDefinition[];
  fields: CredentialFieldDefinition[];
  /** Human-readable abilities used by the UI; definitions stay extensible as integrations grow. */
  capabilities?: string[];
  /** Expected reporting cadence or window, shown without implying fresher data than the API provides. */
  dataFreshness?: string;
  /**
   * Matched against a detected confirmation email's body to find the actual
   * link, for platforms with an `"email_confirm"` step. `[linkPattern, flags]`
   * rather than a `RegExp` because platform definitions are also serialized
   * to the browser as plain JSON.
   */
  confirmationLinkPattern?: [pattern: string, flags: string];
}

/**
 * Where a platform account-creation attempt stands. One row per platform
 * (per agent, when agents matter — signup is usually done once per install).
 * Persisted rather than kept in React state because a real signup can sit
 * waiting on a confirmation email for minutes to hours.
 */
export interface PlatformSignupProgress {
  platformId: string;
  currentStep: number;
  signupEmail: string | null;
  /**
   * Off by default. When true, Jarvis fetches a detected confirmation link
   * itself instead of only surfacing it — an explicit choice the operator
   * makes for this one signup attempt, not a platform-wide default.
   */
  autoFollow: boolean;
  startedAt: string;
  updatedAt: string;
}

export interface StartPlatformSignupRequest {
  signupEmail: string;
  autoFollow?: boolean;
}

/** A confirmation email Jarvis detected for a platform signup in progress. */
export interface SignupEmailEvent {
  id: string;
  platformId: string;
  sender: string;
  subject: string;
  receivedAt: string;
  matchedLink: string | null;
  action: "surfaced" | "auto_followed";
}

/**
 * A Stripe Issuing virtual card Jarvis tracks, one per biller. Deliberately
 * thin — the PAN and CVC never reach the orchestrator at all, so there is
 * nothing more sensitive to carry here than what Stripe already shows on any
 * receipt. See `billing/stripeFunding.ts`.
 */
export interface StripeCardRecord {
  cardId: string;
  purposeLabel: string;
  brand: string;
  last4: string;
  status: string;
  createdAt: string;
}

export interface IssuingBalanceLine {
  amount: number;
  currency: string;
}

export interface IssueStripeCardRequest {
  purposeLabel: string;
  /** In the card's minor currency unit (cents for USD), matching every other *Minor field in this codebase. */
  monthlyLimitMinor: number;
}

/** The nonce Stripe.js generates client-side before requesting a reveal session — see StripeFundingPanel.tsx. */
export interface StripeRevealSessionRequest {
  nonce: string;
}

export interface StripeRevealSession {
  ephemeralKeySecret: string;
}

/**
 * A Coinbase Spend Permission Jarvis's spender address has been granted,
 * read back from the chain — not something Jarvis creates or stores itself.
 * `allowanceMinor` is a decimal string (the on-chain value is a bigint,
 * which JSON can't carry) in the token's smallest unit (6 decimals for
 * USDC). See `billing/walletFunding.ts`.
 */
export interface WalletPermission {
  permissionHash: string;
  /** Contract address; `null` label means Jarvis didn't recognize this token. */
  token: string;
  tokenLabel: string | null;
  allowanceMinor: string;
  periodSeconds: number;
  start: number;
  end: number;
}

export interface WalletSpendRecord {
  id: string;
  purposeLabel: string;
  amountMinor: number;
  token: string;
  txHash: string | null;
  createdAt: string;
}

export interface WalletSpendRequest {
  purposeLabel: string;
  amountMinor: number;
  permissionHash: string;
}

export type ConnectionStatus = "not_connected" | "connected" | "error";

export interface ConnectionRecord {
  /** Stable id for this account. Several may exist for one platform. */
  id: string;
  /** Which agent owns it. Null means the shared pool every agent may use. */
  agentId: string | null;
  /** What to call this account in the UI, e.g. "@acme". Null for the original. */
  label: string | null;
  /** Daily action cap for this account. Null means the global default applies. */
  dailyActionCap: number | null;
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
  /** Push notification to your phone. Only used once Push is connected. */
  notifyPush: boolean;
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
  /** Which account. Null only for rows predating per-account tracking. */
  connectionId: string | null;
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
  notifyPush?: boolean;
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
  | "promoting"
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

export type WorkflowStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type WorkflowApprovalPolicy = "each_item" | "campaign";
export type MarketingChannel = "x" | "linkedin" | "instagram" | "facebook" | "email" | "blog";
export type ContentFormat = "social_post" | "email" | "article" | "ad";
export type ContentStatus = "idea" | "draft" | "review" | "scheduled" | "published" | "measured";
export type WorkflowGenerationStatus = "running" | "completed" | "failed";
export type ContentPublicationStatus = "running" | "published" | "failed";

export interface WorkflowRecord {
  id: string;
  agentId: string | null;
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: MarketingChannel[];
  primaryMetric: string;
  approvalPolicy: WorkflowApprovalPolicy;
  status: WorkflowStatus;
  /**
   * How far five-stage onboarding has got. Resumable by design — a
   * half-configured workflow is a normal state, since stages 3–5 have nothing
   * to show until content exists.
   */
  onboardingStage: number;
  /** Off by default. Automates publish timing, never the approval itself. */
  autopilot: boolean;
  autopilotIntervalHours: number;
  missionId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ContentItemRecord {
  id: string;
  workflowId: string;
  title: string;
  body: string;
  format: ContentFormat;
  channel: MarketingChannel;
  status: ContentStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  performanceSummary: string | null;
  /** Which character version wrote this. Null when no character was set. */
  characterVersion: number | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowGenerationRunRecord {
  id: string;
  /** The character version in force when the run started. */
  characterVersion: number | null;
  workflowId: string;
  sessionId: string;
  status: WorkflowGenerationStatus;
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
  /** The platform's own id for the published post. Null until it succeeds. */
  externalPostId: string | null;
  status: ContentPublicationStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WorkflowOverview {
  workflows: WorkflowRecord[];
  content: ContentItemRecord[];
  generationRuns: WorkflowGenerationRunRecord[];
  publicationRuns: ContentPublicationRunRecord[];
  /** Stage 1 links, for every workflow in this list. */
  accounts: WorkflowAccountRecord[];
  /** The voice each workflow writes in, where one is set. */
  characters: WorkflowCharacterRecord[];
  /** Engagement observations per workflow, for stage 3. Zero until ingestion exists. */
  metricCounts: Record<string, number>;
  /** Stage 5 output per workflow. */
  insightCounts: Record<string, number>;
}

export interface CreateWorkflowRequest {
  name: string;
  objective: string;
  audience: string;
  offer: string;
  channels: MarketingChannel[];
  primaryMetric: string;
  approvalPolicy?: WorkflowApprovalPolicy;
  missionId?: string;
}

export interface UpdateWorkflowRequest {
  name?: string;
  objective?: string;
  audience?: string;
  offer?: string;
  channels?: MarketingChannel[];
  primaryMetric?: string;
  approvalPolicy?: WorkflowApprovalPolicy;
  status?: WorkflowStatus;
  /** Schedules approved content on a cadence. Never bypasses the approval gate. */
  autopilot?: boolean;
  autopilotIntervalHours?: number;
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

export interface GenerateWorkflowContentRequest {
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
  workflowId: string | null;
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
  workflowId?: string;
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

/**
 * Descriptive trend signals across content, workflows, customers, and paid
 * spend — deliberately a read-only summary of what already exists, not a new
 * measurement system. No cross-channel attribution claim ("this post caused
 * that lead") and no automated allocation decision; see GAPS.md's open
 * attribution gap for why that stays a separate, bigger, later increment.
 */
export interface TrendsOverview {
  content: {
    total: number;
    byStatus: Partial<Record<ContentStatus, number>>;
    /** Content that has actually gone out, not just been drafted or scheduled. */
    publishedOrMeasured: number;
  };
  workflows: {
    total: number;
    byStatus: Partial<Record<WorkflowStatus, number>>;
    active: number;
  };
  customers: {
    total: number;
    byStatus: Partial<Record<CustomerConversationStatus, number>>;
    /** Null with zero conversations — a rate over nothing is not zero, it is undefined. */
    resolutionRate: number | null;
  };
  paidGrowth: {
    activeCampaigns: number;
    currency: string | null;
    spentMinor: number;
    revenueMinor: number;
    /** Null when nothing has been spent yet — same reasoning as resolutionRate. */
    roas: number | null;
  };
}

/**
 * One rate-limit window on the Claude subscription these sessions run on.
 *
 * Deliberately not a cost. The subscription already includes this usage, so a
 * dollar figure would imply a bill that does not exist — see the cost rule in
 * CLAUDE.md. What is useful is how much of the window is spent and when it
 * comes back.
 */
export interface ClaudeUsageWindow {
  /** Which window: "five_hour", "seven_day", "seven_day_opus", … */
  type: string;
  status: "allowed" | "allowed_warning" | "rejected";
  /**
   * Percent of the window consumed, 0–100, or null when the SDK does not say.
   * Observed absent on an ordinary `allowed` turn, so null genuinely means
   * "unknown" — reporting it as 0 would claim a full tank on no evidence.
   */
  utilization: number | null;
  /** Epoch seconds when the window resets, when the SDK reports one. */
  resetsAt: number | null;
  /** When Jarvis last heard about this window. */
  updatedAt: string;
}

export interface ClaudeUsageSnapshot {
  /** Every window currently known, most-constrained first. */
  windows: ClaudeUsageWindow[];
  /** The window closest to its limit — what actually bounds the next turn. */
  binding: ClaudeUsageWindow | null;
}

// ---- Workflow stages ----

export type WorkflowStageState = "done" | "ready" | "blocked";
export type WorkflowStageKey =
  | "accounts"
  | "content"
  | "metrics"
  | "advertising"
  | "learning";

export interface WorkflowStageStatus {
  key: WorkflowStageKey;
  /** 1–5, shown in the rail. */
  number: number;
  label: string;
  state: WorkflowStageState;
  /** What is true right now, or why the stage cannot proceed. */
  detail: string;
}

/** One account attached to a workflow (stage 1). */
export interface WorkflowAccountRecord {
  workflowId: string;
  connectionId: string;
  createdAt: string;
}

export interface WorkflowStageInput {
  /** Connections attached to this workflow, already resolved. */
  accounts: ConnectionRecord[];
  content: ContentItemRecord[];
  /** Publication runs for this workflow's content. */
  publicationRuns: ContentPublicationRunRecord[];
  /** How many engagement observations exist for this workflow's content. */
  metricCount: number;
  /** Ad campaigns linked to this workflow. */
  adCampaigns: number;
  /** Whether any advertising platform is connected at all. */
  adPlatformConnected: boolean;
  insightCount: number;
}

/**
 * The five stages, computed from data rather than a stored flag.
 *
 * A stored per-stage flag drifts the moment an account is removed or a post is
 * deleted, and a stage that claims done while its evidence is gone is worse
 * than one that recomputes. `blocked` always carries the specific reason —
 * "needs a published post" is actionable, "unavailable" is not.
 */
export function workflowStages(input: WorkflowStageInput): WorkflowStageStatus[] {
  const connected = input.accounts.filter((account) => account.status === "connected");
  const published = input.publicationRuns.filter((run) => run.status === "published");
  const measurable = published.length;

  const accountNames = connected
    .map((account) => account.label ?? account.platformId)
    .join(", ");

  return [
    {
      key: "accounts",
      number: 1,
      label: "Accounts",
      state: connected.length > 0 ? "done" : "ready",
      detail:
        connected.length > 0
          ? accountNames
          : input.accounts.length > 0
            ? "Attached, but none are connected yet"
            : "Attach an account this workflow posts as",
    },
    {
      key: "content",
      number: 2,
      label: "Content",
      state: input.content.length > 0 ? "done" : "ready",
      detail:
        input.content.length > 0
          ? `${input.content.length} item${input.content.length === 1 ? "" : "s"}, ${published.length} published`
          : "Generate or write the first draft",
    },
    {
      key: "metrics",
      number: 3,
      label: "Metrics",
      state: measurable === 0 ? "blocked" : input.metricCount > 0 ? "done" : "ready",
      detail:
        measurable === 0
          ? "Needs a published post"
          : input.metricCount > 0
            ? `${input.metricCount} observation${input.metricCount === 1 ? "" : "s"}`
            : `${measurable} post${measurable === 1 ? "" : "s"} ready to measure`,
    },
    {
      key: "advertising",
      number: 4,
      label: "Advertising",
      state: input.adCampaigns > 0 ? "done" : input.adPlatformConnected ? "ready" : "blocked",
      detail:
        input.adCampaigns > 0
          ? `${input.adCampaigns} ad campaign${input.adCampaigns === 1 ? "" : "s"} linked`
          : input.adPlatformConnected
            ? "Link ad spend to this workflow"
            : "No ad platform connected",
    },
    {
      key: "learning",
      number: 5,
      label: "Learning",
      state:
        input.insightCount > 0 ? "done" : input.metricCount > 0 ? "ready" : "blocked",
      detail:
        input.insightCount > 0
          ? `${input.insightCount} insight${input.insightCount === 1 ? "" : "s"}`
          : input.metricCount > 0
            ? "Enough measured content to look for a pattern"
            : "Needs measured posts",
    },
  ];
}

/**
 * The voice a workflow speaks in.
 *
 * `exemplars` are sample posts rather than a description of tone: current
 * models match a voice far better from a writing sample than from adjectives,
 * which makes this the highest-value field on the sheet.
 */
export interface WorkflowCharacterRecord {
  workflowId: string;
  name: string;
  persona: string;
  voiceRules: string;
  exemplars: string[];
  appearance: string;
  /** Locked turnaround references. Empty until image generation exists. */
  referenceImageIds: string[];
  /**
   * How this character is disclosed as AI. Required, never optional —
   * presenting an AI persona as a real person is deceptive under FTC Section 5.
   */
  disclosure: string;
  /**
   * Bumped on each material change to the voice. Content records the version
   * that wrote it, so stage 5 can tell a voice change from a topic change.
   */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveWorkflowCharacterRequest {
  name: string;
  persona?: string;
  voiceRules?: string;
  exemplars?: string[];
  appearance?: string;
  disclosure: string;
}

/**
 * Hard per-channel body limits, in characters.
 *
 * Shared so generation and publishing cannot disagree. They previously did:
 * the publish gate enforced X's 280 while the generation prompt only said
 * "match each channel's constraints", and every draft ever produced was
 * rejectable — the pipeline generated content its own gate would refuse.
 */
export const CHANNEL_BODY_LIMITS: Partial<Record<MarketingChannel, number>> = {
  x: 280,
};

// ---- Spend envelopes ----

/** Which rail money moved over. */
export type SpendRail = "wallet" | "card" | "ad_budget";
export type SpendPeriod = "day" | "month";

/**
 * A money limit on one rail.
 *
 * Denominated in money rather than actions, because the daily action cap counts
 * calls and cannot tell twenty cheap posts from twenty expensive ad buys. The
 * currency is part of the envelope and is never converted — see the refusal in
 * checkEnvelopes.
 */
export interface SpendEnvelopeRecord {
  id: string;
  /** Null applies to every agent. */
  agentId: string | null;
  rail: SpendRail;
  period: SpendPeriod;
  limitMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpendLedgerEntry {
  id: string;
  agentId: string | null;
  rail: SpendRail;
  amountMinor: number;
  currency: string;
  reason: string;
  sessionId: string | null;
  /** Provider reference: a transaction hash, a charge id. */
  externalRef: string | null;
  createdAt: string;
}

export interface SetSpendEnvelopeRequest {
  rail: SpendRail;
  period: SpendPeriod;
  limitMinor: number;
  currency: string;
}
