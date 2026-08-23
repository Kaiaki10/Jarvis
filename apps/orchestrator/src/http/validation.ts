import { z } from "zod";

const permissionMode = z.enum(["default", "acceptEdits", "plan", "dontAsk"]);
const allowedTools = z
  .array(z.string().trim().min(1).max(200))
  .max(100)
  .refine(
    (tools) => tools.every(
      (name) => !name.startsWith("mcp__jarvis__") && !name.startsWith("mcp__memory__")
    ),
    "Jarvis-managed tools cannot be pre-approved"
  );
const timeOfDay = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");
const daysOfWeek = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, "days must be unique");

/** Which agent owns a newly created row. Absent means the default agent. */
const agentId = z.string().uuid().optional();

export const createSessionSchema = z
  .object({
    agentId,
    prompt: z.string().trim().min(1).max(100_000),
    cwd: z.string().trim().min(1).max(2_000),
    permissionMode: permissionMode.optional(),
    allowedTools: allowedTools.optional(),
    taskId: z.string().uuid().optional(),
  })
  .strict();

export const messageSchema = z
  .object({ text: z.string().trim().min(1).max(100_000), agentId: z.string().uuid().optional() })
  .strict();

export const chatMessageSchema = z
  .object({
    text: z.string().trim().min(1).max(100_000),
    agentId: z.string().uuid().optional(),
    model: z.enum(["claude", "gpt-5.6-sol"]).default("claude"),
    claudeModel: z.enum(["default", "opus", "haiku", "fable"]).optional(),
    autoApproveLocalTools: z.boolean().optional(),
  })
  .strict();

export const createAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().max(200).optional(),
    systemPrompt: z.string().max(100_000).optional(),
    cwd: z.string().trim().max(2_000).optional(),
    // One or two characters: a letter or a single emoji, sized for the sidebar
    // badge. Anything longer overflows it rather than shrinking.
    avatar: z.string().trim().min(1).max(2).optional(),
    color: z.string().trim().max(40).optional(),
    permissionMode: permissionMode.optional(),
    allowedTools: allowedTools.optional(),
  })
  .strict();

export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.string().trim().max(200).optional(),
    systemPrompt: z.string().max(100_000).optional(),
    cwd: z.string().trim().max(2_000).optional(),
    avatar: z.string().trim().min(1).max(2).optional(),
    color: z.string().trim().max(40).optional(),
    permissionMode: permissionMode.optional(),
    allowedTools: allowedTools.nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "at least one field is required");

const memoryKind = z.enum(["preference", "business", "relationship", "decision", "fact"]);
export const createMemorySchema = z.object({
  kind: memoryKind,
  content: z.string().trim().min(3).max(1_000),
  agentId: z.string().uuid().optional(),
  /** Stores it in the pool every agent reads, rather than against one agent. */
  shared: z.boolean().optional(),
}).strict();
export const updateMemorySchema = z.object({
  kind: memoryKind.optional(),
  content: z.string().trim().min(3).max(1_000).optional(),
  status: z.enum(["active", "archived"]).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "at least one field is required");

export const permissionResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(["allow", "deny"]),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const createTaskSchema = z
  .object({
    agentId,
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20_000).optional(),
    missionId: z.string().uuid().optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    position: z.number().finite().optional(),
    missionId: z.string().uuid().nullable().optional(),
  })
  .strict();

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const createMissionSchema = z.object({
  agentId,
  title: z.string().trim().min(1).max(500),
  outcome: z.string().trim().min(1).max(20_000),
  targetDate: dateOnly.optional(),
}).strict();

export const updateMissionSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  outcome: z.string().trim().min(1).max(20_000).optional(),
  status: z.enum(["planned", "active", "blocked", "completed", "archived"]).optional(),
  targetDate: dateOnly.nullable().optional(),
  nextAction: z.string().trim().max(2_000).nullable().optional(),
}).strict();

export const createDeliverableSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).optional(),
  uri: z.string().trim().max(4_000).optional(),
  sessionId: z.string().uuid().optional(),
}).strict();

export const updateDeliverableSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(20_000).nullable().optional(),
  uri: z.string().trim().max(4_000).nullable().optional(),
  status: z.enum(["draft", "ready", "approved"]).optional(),
}).strict();

export const reviewMissionUpdateSchema = z.object({
  decision: z.enum(["apply", "dismiss"]),
}).strict();

const evolutionChangeClass = z.enum(["knowledge", "behavior", "capability", "product", "security"]);
const evolutionRisk = z.enum(["low", "medium", "high", "critical"]);

export const createEvolutionProposalSchema = z.object({
  title: z.string().trim().min(1).max(500),
  problem: z.string().trim().min(1).max(20_000),
  expectedValue: z.string().trim().min(1).max(20_000),
  changeClass: evolutionChangeClass,
  risk: evolutionRisk,
  evidence: z.string().max(20_000).optional(),
  rollbackPlan: z.string().max(20_000).optional(),
}).strict();

export const updateEvolutionProposalSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  problem: z.string().trim().min(1).max(20_000).optional(),
  expectedValue: z.string().trim().min(1).max(20_000).optional(),
  changeClass: evolutionChangeClass.optional(),
  risk: evolutionRisk.optional(),
  stage: z.enum(["observed", "planned"]).optional(),
  evidence: z.string().max(20_000).nullable().optional(),
  rollbackPlan: z.string().max(20_000).nullable().optional(),
}).strict();

export const updateEvolutionPolicySchema = z.object({
  autonomy: z.enum(["automatic", "after_checks", "approval_required"]),
}).strict();

const marketingChannel = z.enum(["x", "linkedin", "instagram", "facebook", "email", "blog"]);
const contentFormat = z.enum(["social_post", "email", "article", "ad"]);
const campaignChannels = z.array(marketingChannel).min(1).max(6)
  .refine((channels) => new Set(channels).size === channels.length, "channels must be unique");

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(500),
  objective: z.string().trim().min(1).max(20_000),
  audience: z.string().trim().min(1).max(10_000),
  offer: z.string().trim().min(1).max(10_000),
  channels: campaignChannels,
  primaryMetric: z.string().trim().min(1).max(500),
  approvalPolicy: z.enum(["each_item", "campaign"]).optional(),
  missionId: z.string().uuid().optional(),
}).strict();

export const updateWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  objective: z.string().trim().min(1).max(20_000).optional(),
  audience: z.string().trim().min(1).max(10_000).optional(),
  offer: z.string().trim().min(1).max(10_000).optional(),
  channels: campaignChannels.optional(),
  primaryMetric: z.string().trim().min(1).max(500).optional(),
  approvalPolicy: z.enum(["each_item", "campaign"]).optional(),
  status: z.enum(["draft", "active", "paused", "completed", "archived"]).optional(),
  autopilot: z.boolean().optional(),
  // One post an hour is already aggressive; a week is the sane upper bound.
  autopilotIntervalHours: z.number().int().min(1).max(168).optional(),
  missionId: z.string().uuid().nullable().optional(),
}).strict();

export const createContentItemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000),
  format: contentFormat,
  channel: marketingChannel,
  status: z.enum(["idea", "draft"]).optional(),
}).strict();

export const updateContentItemSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  format: contentFormat.optional(),
  channel: marketingChannel.optional(),
  status: z.enum(["idea", "draft", "review", "scheduled", "published", "measured"]).optional(),
  scheduledFor: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "must be a valid date and time").nullable().optional(),
  performanceSummary: z.string().max(20_000).nullable().optional(),
}).strict();

export const generateWorkflowContentSchema = z.object({
  count: z.number().int().min(1).max(12),
  formats: z.array(contentFormat).min(1).max(4)
    .refine((formats) => new Set(formats).size === formats.length, "formats must be unique"),
  channels: campaignChannels.optional(),
  direction: z.string().trim().max(10_000).optional(),
  /** Defaults to opus for voice fidelity; overridable per run. */
  claudeModel: z.enum(["default", "opus", "haiku", "fable"]).optional(),
}).strict();

const paidMediaPlatform = z.enum(["google_ads", "meta_ads", "x_ads"]);
const moneyMinor = z.number().int().min(0).max(1_000_000_000);
const currency = z.string().trim().regex(/^[A-Z]{3}$/, "must be a three-letter currency code");
const externalPaidCampaignId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "must contain only letters, numbers, hyphens, or underscores");

export const createPaidGrowthCampaignSchema = z.object({
  workflowId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(500),
  objective: z.string().trim().min(1).max(20_000),
  platform: paidMediaPlatform,
  externalCampaignId: externalPaidCampaignId.optional(),
  externalBudgetEntityId: externalPaidCampaignId.optional(),
  currency,
  dailyBudgetMinor: moneyMinor.min(100),
  lifetimeBudgetMinor: moneyMinor.min(100),
  targetRoas: z.number().positive().max(100).optional(),
  startDate: dateOnly,
  endDate: dateOnly.optional(),
}).strict().refine((value) => value.lifetimeBudgetMinor >= value.dailyBudgetMinor, {
  message: "lifetime budget must be at least the daily budget",
  path: ["lifetimeBudgetMinor"],
}).refine((value) => !value.endDate || value.endDate >= value.startDate, {
  message: "end date must be on or after the start date",
  path: ["endDate"],
}).refine((value) => !value.externalCampaignId || value.platform === "x_ads" || /^\d+$/.test(value.externalCampaignId), {
  message: "Google Ads and Meta Ads campaign IDs must contain digits only",
  path: ["externalCampaignId"],
}).refine((value) => !value.externalBudgetEntityId || value.platform === "x_ads" || /^\d+$/.test(value.externalBudgetEntityId), {
  message: "Google Ads and Meta Ads budget entity IDs must contain digits only",
  path: ["externalBudgetEntityId"],
});

export const updatePaidGrowthCampaignSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  objective: z.string().trim().min(1).max(20_000).optional(),
  externalCampaignId: externalPaidCampaignId.nullable().optional(),
  externalBudgetEntityId: externalPaidCampaignId.nullable().optional(),
  dailyBudgetMinor: moneyMinor.min(100).optional(),
  lifetimeBudgetMinor: moneyMinor.min(100).optional(),
  targetRoas: z.number().positive().max(100).nullable().optional(),
  startDate: dateOnly.optional(),
  endDate: dateOnly.nullable().optional(),
  status: z.enum(["draft", "paused", "completed"]).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "at least one field is required");

export const updatePaidGrowthPerformanceSchema = z.object({
  spentMinor: moneyMinor,
  revenueMinor: moneyMinor,
  impressions: z.number().int().min(0).max(100_000_000_000),
  clicks: z.number().int().min(0).max(100_000_000_000),
  conversions: z.number().int().min(0).max(100_000_000_000),
}).strict().refine((value) => value.clicks <= value.impressions, {
  message: "clicks cannot exceed impressions",
  path: ["clicks"],
}).refine((value) => value.conversions <= value.clicks, {
  message: "conversions cannot exceed clicks",
  path: ["conversions"],
});

export const reviewPaidGrowthDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
}).strict();

const customerChannel = z.enum(["website", "email", "x", "instagram", "facebook"]);
const customerPriority = z.enum(["low", "normal", "high", "urgent"]);

export const createCustomerConversationSchema = z.object({
  customerName: z.string().trim().min(1).max(300),
  customerEmail: z.union([z.literal(""), z.string().email().max(320)]).optional(),
  company: z.string().trim().max(300).optional(),
  channel: customerChannel,
  subject: z.string().trim().min(1).max(500),
  message: z.string().trim().min(1).max(20_000),
  priority: customerPriority.optional(),
}).strict();

export const updateCustomerConversationSchema = z.object({
  status: z.enum(["open", "waiting", "resolved"]).optional(),
  priority: customerPriority.optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  assignedTo: z.enum(["jarvis", "human"]).optional(),
  summary: z.string().trim().max(10_000).nullable().optional(),
  unreadCount: z.number().int().min(0).max(100_000).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "at least one field is required");

export const createCustomerMessageSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  sender: z.enum(["jarvis", "operator"]).optional(),
  draftId: z.string().uuid().optional(),
}).strict();

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  email: z.union([z.literal(""), z.string().email().max(320)]).nullable().optional(),
  company: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "at least one field is required");

export const updateCustomerServicePolicySchema = z.object({
  enabled: z.boolean().optional(),
  autoReplyWebsite: z.boolean().optional(),
  autoReplyEmail: z.boolean().optional(),
  autoReplySocial: z.boolean().optional(),
  confidenceThreshold: z.number().min(0.5).max(1).optional(),
  maxAutoRepliesPerConversation: z.number().int().min(0).max(20).optional(),
  businessHoursStart: timeOfDay.optional(),
  businessHoursEnd: timeOfDay.optional(),
  businessDays: daysOfWeek.optional(),
  escalationKeywords: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  widgetName: z.string().trim().min(1).max(80).optional(),
  widgetWelcome: z.string().trim().min(1).max(500).optional(),
  allowedOrigins: z.array(z.union([z.literal("*"), z.string().url().max(500)])).max(30).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "at least one field is required");

export const createWebsiteConversationSchema = z.object({
  customerName: z.string().trim().min(1).max(300),
  customerEmail: z.union([z.literal(""), z.string().email().max(320)]).optional(),
  subject: z.string().trim().max(500).optional(),
  body: z.string().trim().min(1).max(20_000),
}).strict();

export const websiteMessageSchema = z.object({
  token: z.string().min(20).max(200),
  body: z.string().trim().min(1).max(20_000),
}).strict();

export const createScheduledTaskSchema = z
  .object({
    agentId,
    prompt: z.string().trim().min(1).max(100_000),
    cwd: z.string().trim().min(1).max(2_000),
    permissionMode: permissionMode.optional(),
    allowedTools: allowedTools.optional(),
    timeOfDay,
    daysOfWeek,
  })
  .strict();

export const updateScheduledTaskSchema = createScheduledTaskSchema.partial().extend({
  enabled: z.boolean().optional(),
});

export const saveConnectionSchema = z
  .object({
    values: z.record(z.string(), z.string().max(20_000)),
    /** Edit one specific account rather than the platform's default. */
    connectionId: z.string().trim().min(1).max(200).optional(),
    /** Add another account alongside the existing ones. */
    createNew: z.boolean().optional(),
    /** What to call this account, e.g. @acme. */
    label: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict();

export const startPlatformSignupSchema = z
  .object({ signupEmail: z.string().email().max(320), autoFollow: z.boolean().optional() })
  .strict();

export const issueStripeCardSchema = z
  .object({ purposeLabel: z.string().trim().min(1).max(200), monthlyLimitMinor: z.number().int().positive() })
  .strict();

export const stripeRevealSessionSchema = z.object({ nonce: z.string().min(1).max(2000) }).strict();

export const walletSpendSchema = z
  .object({
    purposeLabel: z.string().trim().min(1).max(200),
    amountMinor: z.number().int().positive(),
    permissionHash: z.string().trim().min(1).max(200),
  })
  .strict();

export const updateSettingsSchema = z
  .object({
    businessContext: z.string().max(200_000).optional(),
    automationsEnabled: z.boolean().optional(),
    maxConcurrentSessions: z.number().int().min(1).max(10).optional(),
    notifyOnDesktop: z.boolean().optional(),
    notifyEmail: z.union([z.literal(""), z.string().email().max(320)]).optional(),
    notifyPush: z.boolean().optional(),
    approvalTimeoutMinutes: z.number().int().min(0).max(10_080).optional(),
    eventRetentionDays: z.number().int().min(0).max(3_650).optional(),
    dailyPlatformActionCap: z.number().int().min(0).max(10_000).optional(),
    imagesFolder: z.string().max(2_000).optional(),
    chatWorkingDirectory: z.string().max(2_000).optional(),
  })
  .strict();

export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
    .join("; ");
}

export const createConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    topic: z.string().trim().min(1).max(20_000),
    // Two is the minimum for a conversation; the upper bound keeps one room
    // from monopolising the machine and makes the transcript readable.
    agentIds: z
      .array(z.string().uuid())
      .min(2)
      .max(5)
      .refine((ids) => new Set(ids).size === ids.length, "an agent cannot appear twice"),
    // Bounded here as well as in the runner: these are what stop two agents
    // talking all night, so an out-of-range value is rejected rather than
    // clamped somewhere the caller cannot see.
    turnCap: z.number().int().min(2).max(40).optional(),
    budgetSeconds: z.number().int().min(60).max(3_600).optional(),
  })
  .strict();

export const conversationMessageSchema = z
  .object({ text: z.string().trim().min(1).max(20_000) })
  .strict();

export const attachWorkflowAccountSchema = z
  .object({ connectionId: z.string().trim().min(1).max(200) })
  .strict();

export const saveWorkflowCharacterSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    persona: z.string().max(20_000).optional(),
    voiceRules: z.string().max(20_000).optional(),
    exemplars: z.array(z.string().trim().min(1).max(10_000)).max(20).optional(),
    appearance: z.string().max(20_000).optional(),
    // Required, never optional — see CHARACTER_PLAN.md.
    disclosure: z.string().trim().min(1).max(2_000),
  })
  .strict();

/** Null clears the per-account override; the global default then applies. */
export const setConnectionCapSchema = z
  .object({ dailyActionCap: z.number().int().min(0).max(10_000).nullable() })
  .strict();

export const setSpendEnvelopeSchema = z
  .object({
    rail: z.enum(["wallet", "card", "ad_budget"]),
    period: z.enum(["day", "month"]),
    /** Minor units: USDC has 6 decimals, USD cents 2. Never converted. */
    limitMinor: z.number().int().min(0).max(1_000_000_000),
    currency: z.string().trim().min(2).max(10),
  })
  .strict();
