import type {
  AgentRecord,
  UpdateAgentRequest,
  ConnectionRecord,
  CreateScheduledTaskRequest,
  CreateSessionRequest,
  MaintenanceResult,
  NotificationRecord,
  PlatformDefinition,
  StorageStats,
  TestConnectionResult,
  PermissionResponseRequest,
  ScheduledTaskRecord,
  SessionEventRecord,
  SessionRecord,
  SettingsRecord,
  TaskRecord,
  TaskStatus,
  UpdateScheduledTaskRequest,
  UpdateSettingsRequest,
  MissionRecord,
  DeliverableRecord,
  CreateMissionRequest,
  UpdateMissionRequest,
  CreateDeliverableRequest,
  DeliverableStatus,
  AutomationRehearsal,
  MissionUpdateRecord,
  WorkflowOverview,
  WorkflowRecord,
  ContentItemRecord,
  WorkflowGenerationRunRecord,
  ContentPublicationRunRecord,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  CreateContentItemRequest,
  UpdateContentItemRequest,
  GenerateWorkflowContentRequest,
  MemoryRecord,
  MemoryReflectionRecord,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  CustomerOperationsOverview,
  CustomerConversationRecord,
  CustomerMessageRecord,
  CustomerRecord,
  CustomerReplyDraftRecord,
  CreateCustomerConversationRequest,
  UpdateCustomerConversationRequest,
  CreateCustomerMessageRequest,
  UpdateCustomerRequest,
  CustomerServicePolicyRecord,
  UpdateCustomerServicePolicyRequest,
  PaidGrowthOverview,
  TrendsOverview,
  IssuingBalanceLine,
  StripeCardRecord,
  IssueStripeCardRequest,
  StripePaymentLinkRecord,
  CreatePaymentLinkRequest,
  MoneyReceiptRecord,
  StripeRevealSessionRequest,
  StripeRevealSession,
  WalletPermission,
  WalletSpendRecord,
  PaidGrowthCampaignRecord,
  PaidGrowthDecisionRecord,
  CreatePaidGrowthCampaignRequest,
  UpdatePaidGrowthCampaignRequest,
  UpdatePaidGrowthPerformanceRequest,
  MeasurementFactRecord,
  CampaignExperimentRecord,
  CampaignExperimentsOverview,
  CreateCampaignExperimentRequest,
  ChatModel,
  LocalModelsStatus,
  OpenCodeModelsStatus,
  ClaudeModel,
  ClaudeUsageSnapshot,
  SpendEnvelopeRecord,
  SpendLedgerEntry,
  SetSpendEnvelopeRequest,
} from "@jarvis/shared";

/**
 * `localhost`, not `127.0.0.1` — proven live while building passkey login
 * (`app/login/page.tsx`): Chromium's WebAuthn implementation rejects an
 * IP-literal RP ID outright ("This is an invalid domain."), and `localhost`
 * is the only loopback hostname it accepts without a real DNS domain. Once
 * the page's own origin has to be `localhost` for that reason, every
 * orchestrator call from the browser has to target `localhost` too — mixing
 * `localhost` and `127.0.0.1` are different *sites* for SameSite cookie
 * purposes despite both resolving to loopback, so the session cookie
 * wouldn't reach the orchestrator otherwise. This matches `WEB_ORIGIN`'s own
 * default in `http/server.ts`, which already assumed `localhost`.
 */
export const BASE_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4317";

export const customerWidgetDemoUrl = `${BASE_URL}/widget/demo`;
export const customerWidgetEmbedCode = `<script src="${BASE_URL}/widget/customer-chat.js" data-jarvis-url="${BASE_URL}" async></script>`;

/**
 * The orchestrator's API token, fetched once from this app's own server.
 *
 * Held as the in-flight promise rather than the resolved value so that the
 * many requests fired on first paint share a single round trip instead of
 * racing to fetch the same secret.
 */
let tokenPromise: Promise<string> | null = null;

export function ensureApiToken(): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = fetch("/api/token", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(error ?? "Could not read the orchestrator API token.");
        }
        return ((await res.json()) as { token: string }).token;
      })
      .catch((err) => {
        // Clear the cache so a later attempt can succeed — otherwise one failure
        // during startup would leave the dashboard permanently unauthenticated.
        tokenPromise = null;
        throw err;
      });
  }
  return tokenPromise;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await ensureApiToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // The orchestrator returns { error } with a message written for a person;
    // prefer that over dumping status codes and raw bodies into the UI.
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Not JSON — fall back to the raw body.
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  return res.blob();
}

export const api = {
  /** Jarvis's own record — persona, working directory, and brain. */
  getJarvis: () => request<AgentRecord>("/agent"),
  updateJarvis: (patch: UpdateAgentRequest) =>
    request<AgentRecord>("/agent", { method: "PATCH", body: JSON.stringify(patch) }),

  listMemories: (status?: "active" | "archived") =>
    request<MemoryRecord[]>(`/memories${status ? `?status=${status}` : ""}`),
  listMemoryReflections: () => request<MemoryReflectionRecord[]>("/memory-reflections"),
  createMemory: (body: CreateMemoryRequest) =>
    request<MemoryRecord>("/memories", { method: "POST", body: JSON.stringify(body) }),
  updateMemory: (id: string, patch: UpdateMemoryRequest) =>
    request<MemoryRecord>(`/memories/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  listSessions: () => request<SessionRecord[]>("/sessions"),
  getSpend: () =>
    request<{ envelopes: SpendEnvelopeRecord[]; ledger: SpendLedgerEntry[] }>("/spend"),
  setSpendEnvelope: (body: SetSpendEnvelopeRequest) =>
    request<SpendEnvelopeRecord>("/spend/envelopes", { method: "PUT", body: JSON.stringify(body) }),
  removeSpendEnvelope: (id: string) =>
    request<void>(`/spend/envelopes/${id}`, { method: "DELETE" }),
  /** Subscription headroom for the Claude account Jarvis runs on. */
  getUsage: () => request<ClaudeUsageSnapshot>("/usage"),
  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, { method: "DELETE" }),

  getChat: (model: ChatModel = "claude") =>
    request<{ session: SessionRecord | null }>(`/chat?model=${encodeURIComponent(model)}`),
  sendChat: (
    text: string,
    model: ChatModel = "claude",
    claudeModel?: ClaudeModel,
    autoApproveLocalTools?: boolean,
    localModel?: string,
    opencodeModel?: string
  ) =>
    request<{ sessionId: string; resumed: boolean }>("/chat", {
      method: "POST",
      body: JSON.stringify({
        text,
        model,
        claudeModel,
        localModel,
        opencodeModel,
        autoApproveLocalTools,
      }),
    }),
  getLocalModels: () => request<LocalModelsStatus>("/chat/local-models"),
  getOpencodeModels: () => request<OpenCodeModelsStatus>("/chat/opencode-models"),
  getSession: (id: string) => request<SessionRecord>(`/sessions/${id}`),
  createSession: (body: CreateSessionRequest) =>
    request<SessionRecord>("/sessions", {
      method: "POST",
      body: JSON.stringify({ ...body }),
    }),
  getSessionEvents: (id: string, since = 0) =>
    request<SessionEventRecord[]>(`/sessions/${id}/events?since=${since}`),
  sendMessage: (id: string, text: string) =>
    request<{ ok: boolean; resumed: boolean }>(`/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  respondToPermission: (id: string, body: PermissionResponseRequest) =>
    request<{ ok: boolean }>(`/sessions/${id}/permission-response`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  interruptSession: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${id}/interrupt`, { method: "POST" }),

  listTasks: () => request<TaskRecord[]>("/tasks"),
  createTask: (title: string, description?: string, missionId?: string) =>
    request<TaskRecord>("/tasks", {
      method: "POST",
      body: JSON.stringify({ title, description, missionId }),
    }),
  updateTask: (
    id: string,
    patch: Partial<{ title: string; description: string; status: TaskStatus; position: number; missionId: string | null }>
  ) =>
    request<TaskRecord>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  listMissions: () => request<MissionRecord[]>("/missions"),
  getMission: (id: string) => request<{ mission: MissionRecord; tasks: TaskRecord[]; deliverables: DeliverableRecord[]; updates: MissionUpdateRecord[] }>(`/missions/${id}`),
  createMission: (body: CreateMissionRequest) => request<MissionRecord>("/missions", {
    method: "POST",
    body: JSON.stringify({ ...body }),
  }),
  updateMission: (id: string, patch: UpdateMissionRequest) => request<MissionRecord>(`/missions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  advanceMission: (id: string) => request<{ mission: MissionRecord; task: TaskRecord; session: SessionRecord }>(`/missions/${id}/advance`, { method: "POST" }),
  deleteMission: (id: string) => request<void>(`/missions/${id}`, { method: "DELETE" }),
  listDeliverables: () => request<DeliverableRecord[]>("/deliverables"),
  createDeliverable: (missionId: string, body: CreateDeliverableRequest) => request<DeliverableRecord>(`/missions/${missionId}/deliverables`, {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateDeliverable: (id: string, patch: Partial<{ title: string; description: string | null; uri: string | null; status: DeliverableStatus }>) => request<DeliverableRecord>(`/deliverables/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  deleteDeliverable: (id: string) => request<void>(`/deliverables/${id}`, { method: "DELETE" }),
  listMissionUpdates: () => request<MissionUpdateRecord[]>("/mission-updates"),
  reviewMissionUpdate: (id: string, decision: "apply" | "dismiss") => request<{ update: MissionUpdateRecord; mission: MissionRecord }>(`/mission-updates/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  }),

  getWorkflows: () => request<WorkflowOverview>("/workflows"),
  getWorkflow: (id: string) => request<{ workflow: WorkflowRecord; content: ContentItemRecord[]; generationRuns: WorkflowGenerationRunRecord[]; publicationRuns: ContentPublicationRunRecord[] }>(`/workflows/${id}`),
  createWorkflow: (body: CreateWorkflowRequest) => request<WorkflowRecord>("/workflows", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateWorkflow: (id: string, patch: UpdateWorkflowRequest) => request<WorkflowRecord>(`/workflows/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  /** Test one specific account. The platform-keyed route refuses once several exist. */
  testAccount: (connectionId: string) =>
    request<{ result: TestConnectionResult; connection: ConnectionRecord }>(
      `/accounts/${connectionId}/test`,
      { method: "POST" }
    ),
  deleteAccount: (connectionId: string) =>
    request<void>(`/accounts/${connectionId}`, { method: "DELETE" }),
  /** Null clears the override so the global default applies again. */
  setConnectionCap: (connectionId: string, dailyActionCap: number | null) =>
    request<ConnectionRecord>(`/connections/${connectionId}/cap`, {
      method: "PATCH",
      body: JSON.stringify({ dailyActionCap }),
    }),
  attachWorkflowAccount: (workflowId: string, connectionId: string) =>
    request<{ workflowId: string; connectionId: string }>(`/workflows/${workflowId}/accounts`, {
      method: "POST",
      body: JSON.stringify({ connectionId }),
    }),
  detachWorkflowAccount: (workflowId: string, connectionId: string) =>
    request<void>(`/workflows/${workflowId}/accounts/${connectionId}`, { method: "DELETE" }),
  deleteWorkflow: (id: string) => request<void>(`/workflows/${id}`, { method: "DELETE" }),
  createContentItem: (workflowId: string, body: CreateContentItemRequest) => request<ContentItemRecord>(`/workflows/${workflowId}/content`, {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateContentItem: (id: string, patch: UpdateContentItemRequest) => request<ContentItemRecord>(`/content/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  deleteContentItem: (id: string) => request<void>(`/content/${id}`, { method: "DELETE" }),
  publishContentItem: (id: string) => request<{ sessionId: string; runId: string }>(`/content/${id}/publish`, { method: "POST" }),
  generateWorkflowContent: (id: string, body: GenerateWorkflowContentRequest) => request<{ workflow: WorkflowRecord; session: SessionRecord; generationRun: WorkflowGenerationRunRecord }>(`/workflows/${id}/generate`, {
    method: "POST",
    body: JSON.stringify(body),
  }),

  getPaidGrowth: () => request<PaidGrowthOverview>("/paid-growth"),
  getTrends: () => request<TrendsOverview>("/insights/trends"),
  createPaidGrowthCampaign: (body: CreatePaidGrowthCampaignRequest) =>
    request<PaidGrowthCampaignRecord>("/paid-growth/workflows", { method: "POST", body: JSON.stringify(body) }),
  updatePaidGrowthCampaign: (id: string, patch: UpdatePaidGrowthCampaignRequest) =>
    request<PaidGrowthCampaignRecord>(`/paid-growth/workflows/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  updatePaidGrowthPerformance: (id: string, body: UpdatePaidGrowthPerformanceRequest) =>
    request<PaidGrowthCampaignRecord>(`/paid-growth/workflows/${id}/performance`, { method: "POST", body: JSON.stringify(body) }),
  syncPaidGrowthCampaign: (id: string) =>
    request<{ campaign: PaidGrowthCampaignRecord; decisions: PaidGrowthDecisionRecord[]; overview: PaidGrowthOverview }>(`/paid-growth/workflows/${id}/sync`, { method: "POST" }),
  requestPaidGrowthLaunch: (id: string) =>
    request<PaidGrowthDecisionRecord>(`/paid-growth/workflows/${id}/request-launch`, { method: "POST" }),
  refreshPaidGrowthRecommendations: () =>
    request<{ created: PaidGrowthDecisionRecord[]; overview: PaidGrowthOverview }>("/paid-growth/recommendations/refresh", { method: "POST" }),
  reviewPaidGrowthDecision: (id: string, decision: "approve" | "reject") =>
    request<{ decision: PaidGrowthDecisionRecord; overview: PaidGrowthOverview }>(`/paid-growth/decisions/${id}/review`, { method: "POST", body: JSON.stringify({ decision }) }),
  getPaidGrowthHistory: (id: string) =>
    request<MeasurementFactRecord[]>(`/paid-growth/workflows/${id}/history`),
  getCampaignExperiments: () =>
    request<CampaignExperimentsOverview>("/paid-growth/experiments"),
  createCampaignExperiment: (body: CreateCampaignExperimentRequest) =>
    request<CampaignExperimentRecord>("/paid-growth/experiments", { method: "POST", body: JSON.stringify(body) }),
  concludeCampaignExperiment: (id: string) =>
    request<{ experiment: CampaignExperimentRecord; decision: PaidGrowthDecisionRecord | null; overview: CampaignExperimentsOverview }>(`/paid-growth/experiments/${id}/conclude`, { method: "POST" }),
  abandonCampaignExperiment: (id: string, reason: string) =>
    request<{ experiment: CampaignExperimentRecord; overview: CampaignExperimentsOverview }>(`/paid-growth/experiments/${id}/abandon`, { method: "POST", body: JSON.stringify({ reason }) }),

  getCustomerOperations: () => request<CustomerOperationsOverview>("/customer-operations"),
  updateCustomerServicePolicy: (patch: UpdateCustomerServicePolicyRequest) =>
    request<CustomerServicePolicyRecord>("/customer-service-policy", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  createCustomerConversation: (body: CreateCustomerConversationRequest) => request<{
    customer: CustomerRecord;
    conversation: CustomerConversationRecord;
    message: CustomerMessageRecord;
  }>("/customer-conversations", { method: "POST", body: JSON.stringify(body) }),
  updateCustomerConversation: (id: string, patch: UpdateCustomerConversationRequest) =>
    request<CustomerConversationRecord>(`/customer-conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCustomerConversation: (id: string) =>
    request<void>(`/customer-conversations/${id}`, { method: "DELETE" }),
  updateCustomer: (id: string, patch: UpdateCustomerRequest) =>
    request<CustomerRecord>(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  sendCustomerMessage: (id: string, body: CreateCustomerMessageRequest) =>
    request<CustomerMessageRecord>(`/customer-conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  draftCustomerReply: (id: string) => request<{ session: SessionRecord; draft: CustomerReplyDraftRecord }>(
    `/customer-conversations/${id}/drafts`,
    { method: "POST" }
  ),
  escalateCustomerConversation: (id: string) =>
    request<{ conversation: CustomerConversationRecord; task: TaskRecord }>(
      `/customer-conversations/${id}/escalate`,
      { method: "POST" }
    ),
  createCustomerFollowUp: (id: string) =>
    request<TaskRecord>(`/customer-conversations/${id}/follow-up`, { method: "POST" }),

  listScheduledTasks: () => request<ScheduledTaskRecord[]>("/scheduled-tasks"),
  createScheduledTask: (body: CreateScheduledTaskRequest) =>
    request<ScheduledTaskRecord>("/scheduled-tasks", {
      method: "POST",
      body: JSON.stringify({ ...body }),
    }),
  updateScheduledTask: (id: string, patch: UpdateScheduledTaskRequest) =>
    request<ScheduledTaskRecord>(`/scheduled-tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteScheduledTask: (id: string) =>
    request<void>(`/scheduled-tasks/${id}`, { method: "DELETE" }),
  rehearseScheduledTask: (id: string) =>
    request<AutomationRehearsal>(`/scheduled-tasks/${id}/rehearsal`),

  listPlatforms: () => request<PlatformDefinition[]>("/platforms"),
  listConnections: () => request<ConnectionRecord[]>("/connections"),
  saveConnection: (
    platformId: string,
    values: Record<string, string>,
    /** `createNew` adds an account alongside the existing ones rather than editing one. */
    options: { connectionId?: string; createNew?: boolean; label?: string | null } = {}
  ) =>
    request<ConnectionRecord>(`/connections/${platformId}`, {
      method: "PUT",
      body: JSON.stringify({ values, ...options }),
    }),
  testConnection: (platformId: string) =>
    request<{ result: TestConnectionResult; connection: ConnectionRecord }>(
      `/connections/${platformId}/test`,
      { method: "POST" }
    ),
  deleteConnection: (platformId: string) =>
    request<void>(`/connections/${platformId}`, { method: "DELETE" }),

  getStripeBalance: () => request<IssuingBalanceLine[]>("/billing/stripe/balance"),
  listStripeCards: () => request<StripeCardRecord[]>("/billing/stripe/cards"),
  issueStripeCard: (body: IssueStripeCardRequest) =>
    request<StripeCardRecord>("/billing/stripe/cards", { method: "POST", body: JSON.stringify(body) }),
  cancelStripeCard: (cardId: string) =>
    request<void>(`/billing/stripe/cards/${cardId}`, { method: "DELETE" }),
  createStripeRevealSession: (cardId: string, body: StripeRevealSessionRequest) =>
    request<StripeRevealSession>(`/billing/stripe/cards/${cardId}/reveal-session`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listPaymentLinks: () => request<StripePaymentLinkRecord[]>("/billing/stripe/payment-links"),
  createPaymentLink: (body: CreatePaymentLinkRequest) =>
    request<StripePaymentLinkRecord>("/billing/stripe/payment-links", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listMoneyReceipts: () => request<MoneyReceiptRecord[]>("/billing/money/receipts"),

  getWalletSpenderAddress: () => request<{ address: string }>("/billing/wallet/spender-address"),
  listWalletPermissions: () => request<WalletPermission[]>("/billing/wallet/permissions"),
  listWalletSpends: () => request<WalletSpendRecord[]>("/billing/wallet/spends"),
  getWalletGrantCapability: () =>
    request<{ canGrant: boolean }>("/billing/wallet/grant-capability"),
  grantWalletPermission: (body: {
    allowanceMinor: number;
    periodInDays: number;
    expiresInDays: number;
  }) =>
    request<{ userOpHash: string }>("/billing/wallet/permissions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revokeWalletPermission: (permissionHash: string) =>
    request<void>(`/billing/wallet/permissions/${encodeURIComponent(permissionHash)}`, {
      method: "DELETE",
    }),

  getStorage: () => request<StorageStats>("/storage"),
  compactStorage: () =>
    request<{ result: MaintenanceResult; stats: StorageStats }>("/storage/compact", {
      method: "POST",
    }),

  listNotifications: () =>
    request<{ items: NotificationRecord[]; unread: number }>("/notifications"),
  markNotificationRead: (id: string) =>
    request<{ ok: boolean }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () =>
    request<{ ok: boolean }>("/notifications/read-all", { method: "POST" }),

  exportBackup: (passphrase: string) =>
    request<Record<string, unknown>>("/backup/export", {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    }),
  downloadDataBackup: () => requestBlob("/backup/database"),
  importBackup: (passphrase: string, bundle: unknown) =>
    request<{ restored: string[]; skipped: string[] }>("/backup/import", {
      method: "POST",
      body: JSON.stringify({ passphrase, bundle }),
    }),

  getSettings: () => request<SettingsRecord>("/settings"),
  updateSettings: (patch: UpdateSettingsRequest) =>
    request<SettingsRecord>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

/**
 * EventSource cannot set an Authorization header, so the stream endpoints take
 * the token in the query string. Both builders are async because the token is
 * fetched once at runtime rather than baked in at build time.
 */
export async function sessionStreamUrl(sessionId: string, since = 0) {
  const token = await ensureApiToken();
  const path = `/sessions/${sessionId}/stream?since=${since}`;
  return `${BASE_URL}${path}&token=${encodeURIComponent(token)}`;
}

export async function globalEventsUrl() {
  const token = await ensureApiToken();
  return `${BASE_URL}/events?token=${encodeURIComponent(token)}`;
}
