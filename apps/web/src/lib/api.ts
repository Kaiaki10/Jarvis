import type {
  AgentRecord,
  AgentConversationRecord,
  AgentConversationDetail,
  AgentConversationMessageRecord,
  CreateAgentConversationRequest,
  CreateAgentRequest,
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
  EvolutionOverview,
  EvolutionProposalRecord,
  CreateEvolutionProposalRequest,
  EvolutionAutonomy,
  EvolutionChangeClass,
  CampaignOverview,
  CampaignRecord,
  ContentItemRecord,
  CampaignGenerationRunRecord,
  ContentPublicationRunRecord,
  CreateCampaignRequest,
  UpdateCampaignRequest,
  CreateContentItemRequest,
  UpdateContentItemRequest,
  GenerateCampaignContentRequest,
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
  PaidGrowthCampaignRecord,
  PaidGrowthDecisionRecord,
  CreatePaidGrowthCampaignRequest,
  UpdatePaidGrowthCampaignRequest,
  UpdatePaidGrowthPerformanceRequest,
} from "@jarvis/shared";

const BASE_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://127.0.0.1:4317";

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

/**
 * The agent whose workspace the dashboard is showing.
 *
 * Held in a module variable rather than threaded through every call site: the
 * store sets it as soon as the selection is known, and every list request picks
 * it up. A request made before selection resolves is unscoped, which shows the
 * default agent's data rather than nothing.
 */
let activeAgentId: string | null = null;

export function setActiveAgentId(id: string | null) {
  activeAgentId = id;
}

export function getActiveAgentId(): string | null {
  return activeAgentId;
}

/** Appends the active agent to a query string, preserving any existing params. */
function scoped(path: string): string {
  if (!activeAgentId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}agentId=${encodeURIComponent(activeAgentId)}`;
}

export const api = {
  listConversations: () => request<AgentConversationRecord[]>("/conversations"),
  getConversation: (id: string) => request<AgentConversationDetail>(`/conversations/${id}`),
  createConversation: (body: CreateAgentConversationRequest) =>
    request<AgentConversationRecord>("/conversations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  startConversation: (id: string) =>
    request<{ ok: boolean }>(`/conversations/${id}/start`, { method: "POST" }),
  stopConversation: (id: string) =>
    request<AgentConversationRecord>(`/conversations/${id}/stop`, { method: "POST" }),
  sendConversationMessage: (id: string, text: string) =>
    request<AgentConversationMessageRecord>(`/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  deleteConversation: (id: string) =>
    request<void>(`/conversations/${id}`, { method: "DELETE" }),

  listAgents: (status?: "active" | "archived") =>
    request<AgentRecord[]>(`/agents${status ? `?status=${status}` : ""}`),
  getAgent: (id: string) => request<AgentRecord>(`/agents/${id}`),
  createAgent: (body: CreateAgentRequest) =>
    request<AgentRecord>("/agents", { method: "POST", body: JSON.stringify(body) }),
  updateAgent: (id: string, patch: UpdateAgentRequest) =>
    request<AgentRecord>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  /** Archives rather than deletes, so the agent's history stays attributable. */
  archiveAgent: (id: string) => request<AgentRecord>(`/agents/${id}`, { method: "DELETE" }),

  listMemories: (status?: "active" | "archived") =>
    request<MemoryRecord[]>(`/memories${status ? `?status=${status}` : ""}`),
  listMemoryReflections: () => request<MemoryReflectionRecord[]>("/memory-reflections"),
  createMemory: (body: CreateMemoryRequest) =>
    request<MemoryRecord>("/memories", { method: "POST", body: JSON.stringify(body) }),
  updateMemory: (id: string, patch: UpdateMemoryRequest) =>
    request<MemoryRecord>(`/memories/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  listSessions: () => request<SessionRecord[]>(scoped("/sessions")),
  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, { method: "DELETE" }),

  getChat: () => request<{ session: SessionRecord | null }>(scoped("/chat")),
  sendChat: (text: string) =>
    request<{ sessionId: string; resumed: boolean }>("/chat", {
      method: "POST",
      body: JSON.stringify({ text, agentId: getActiveAgentId() ?? undefined }),
    }),
  getSession: (id: string) => request<SessionRecord>(`/sessions/${id}`),
  createSession: (body: CreateSessionRequest) =>
    request<SessionRecord>("/sessions", {
      method: "POST",
      body: JSON.stringify({ ...body, agentId: getActiveAgentId() ?? undefined }),
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

  listTasks: () => request<TaskRecord[]>(scoped("/tasks")),
  createTask: (title: string, description?: string, missionId?: string) =>
    request<TaskRecord>("/tasks", {
      method: "POST",
      body: JSON.stringify({ title, description, missionId, agentId: getActiveAgentId() ?? undefined }),
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

  listMissions: () => request<MissionRecord[]>(scoped("/missions")),
  getMission: (id: string) => request<{ mission: MissionRecord; tasks: TaskRecord[]; deliverables: DeliverableRecord[]; updates: MissionUpdateRecord[] }>(`/missions/${id}`),
  createMission: (body: CreateMissionRequest) => request<MissionRecord>("/missions", {
    method: "POST",
    body: JSON.stringify({ ...body, agentId: getActiveAgentId() ?? undefined }),
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

  getEvolution: () => request<EvolutionOverview>("/evolution"),
  createEvolutionProposal: (body: CreateEvolutionProposalRequest) => request<EvolutionProposalRecord>("/evolution/proposals", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateEvolutionProposal: (id: string, patch: Partial<CreateEvolutionProposalRequest & { stage: "observed" | "planned" }>) => request<EvolutionProposalRecord>(`/evolution/proposals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  updateEvolutionPolicy: (changeClass: EvolutionChangeClass, autonomy: EvolutionAutonomy) => request(`/evolution/policies/${changeClass}`, {
    method: "PATCH",
    body: JSON.stringify({ autonomy }),
  }),
  startEvolutionBuild: (id: string) => request<{ proposal: EvolutionProposalRecord; session: SessionRecord }>(`/evolution/proposals/${id}/start-build`, { method: "POST" }),

  getCampaigns: () => request<CampaignOverview>("/campaigns"),
  getCampaign: (id: string) => request<{ campaign: CampaignRecord; content: ContentItemRecord[]; generationRuns: CampaignGenerationRunRecord[]; publicationRuns: ContentPublicationRunRecord[] }>(`/campaigns/${id}`),
  createCampaign: (body: CreateCampaignRequest) => request<CampaignRecord>("/campaigns", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateCampaign: (id: string, patch: UpdateCampaignRequest) => request<CampaignRecord>(`/campaigns/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  deleteCampaign: (id: string) => request<void>(`/campaigns/${id}`, { method: "DELETE" }),
  createContentItem: (campaignId: string, body: CreateContentItemRequest) => request<ContentItemRecord>(`/campaigns/${campaignId}/content`, {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateContentItem: (id: string, patch: UpdateContentItemRequest) => request<ContentItemRecord>(`/content/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  deleteContentItem: (id: string) => request<void>(`/content/${id}`, { method: "DELETE" }),
  publishContentItem: (id: string) => request<{ sessionId: string; runId: string }>(`/content/${id}/publish`, { method: "POST" }),
  generateCampaignContent: (id: string, body: GenerateCampaignContentRequest) => request<{ campaign: CampaignRecord; session: SessionRecord; generationRun: CampaignGenerationRunRecord }>(`/campaigns/${id}/generate`, {
    method: "POST",
    body: JSON.stringify(body),
  }),

  getPaidGrowth: () => request<PaidGrowthOverview>("/paid-growth"),
  createPaidGrowthCampaign: (body: CreatePaidGrowthCampaignRequest) =>
    request<PaidGrowthCampaignRecord>("/paid-growth/campaigns", { method: "POST", body: JSON.stringify(body) }),
  updatePaidGrowthCampaign: (id: string, patch: UpdatePaidGrowthCampaignRequest) =>
    request<PaidGrowthCampaignRecord>(`/paid-growth/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  updatePaidGrowthPerformance: (id: string, body: UpdatePaidGrowthPerformanceRequest) =>
    request<PaidGrowthCampaignRecord>(`/paid-growth/campaigns/${id}/performance`, { method: "POST", body: JSON.stringify(body) }),
  syncPaidGrowthCampaign: (id: string) =>
    request<{ campaign: PaidGrowthCampaignRecord; decisions: PaidGrowthDecisionRecord[]; overview: PaidGrowthOverview }>(`/paid-growth/campaigns/${id}/sync`, { method: "POST" }),
  requestPaidGrowthLaunch: (id: string) =>
    request<PaidGrowthDecisionRecord>(`/paid-growth/campaigns/${id}/request-launch`, { method: "POST" }),
  refreshPaidGrowthRecommendations: () =>
    request<{ created: PaidGrowthDecisionRecord[]; overview: PaidGrowthOverview }>("/paid-growth/recommendations/refresh", { method: "POST" }),
  reviewPaidGrowthDecision: (id: string, decision: "approve" | "reject") =>
    request<{ decision: PaidGrowthDecisionRecord; overview: PaidGrowthOverview }>(`/paid-growth/decisions/${id}/review`, { method: "POST", body: JSON.stringify({ decision }) }),

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

  listScheduledTasks: () => request<ScheduledTaskRecord[]>(scoped("/scheduled-tasks")),
  createScheduledTask: (body: CreateScheduledTaskRequest) =>
    request<ScheduledTaskRecord>("/scheduled-tasks", {
      method: "POST",
      body: JSON.stringify({ ...body, agentId: getActiveAgentId() ?? undefined }),
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
  saveConnection: (platformId: string, values: Record<string, string>) =>
    request<ConnectionRecord>(`/connections/${platformId}`, {
      method: "PUT",
      body: JSON.stringify({ values }),
    }),
  testConnection: (platformId: string) =>
    request<{ result: TestConnectionResult; connection: ConnectionRecord }>(
      `/connections/${platformId}/test`,
      { method: "POST" }
    ),
  deleteConnection: (platformId: string) =>
    request<void>(`/connections/${platformId}`, { method: "DELETE" }),

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
  return `${BASE_URL}/sessions/${sessionId}/stream?since=${since}&token=${encodeURIComponent(token)}`;
}

export async function globalEventsUrl() {
  const token = await ensureApiToken();
  return `${BASE_URL}/events?token=${encodeURIComponent(token)}`;
}
