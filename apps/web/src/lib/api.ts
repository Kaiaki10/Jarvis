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
  PlatformSignupProgress,
  SignupEmailEvent,
  StartPlatformSignupRequest,
  IssuingBalanceLine,
  StripeCardRecord,
  IssueStripeCardRequest,
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
  ClaudeModel,
  ClaudeUsageSnapshot,
  SpendEnvelopeRecord,
  SpendLedgerEntry,
  SetSpendEnvelopeRequest,
  WorkflowCharacterRecord,
  SaveWorkflowCharacterRequest,
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

interface AgentTokenEntry {
  token: string;
  expiresAt: number;
}

/** Re-mint this far ahead of expiry so a request never races a token dying mid-flight. */
const AGENT_TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * One scoped token per agent, keyed the same way `activeAgentId` is —
 * per-agent, not global, since each carries entitlement to exactly one agent
 * (see `agentAuth.ts` on the orchestrator: an agent-scoped token is not valid
 * for any other agent, or for an unscoped request).
 */
const agentTokenCache = new Map<string, Promise<AgentTokenEntry>>();

async function mintAgentToken(agentId: string): Promise<AgentTokenEntry> {
  const res = await fetch(`/api/token?agentId=${encodeURIComponent(agentId)}`, { cache: "no-store" });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Could not mint an agent-scoped token.");
  }
  const body = (await res.json()) as { token: string; expiresAt: string };
  return { token: body.token, expiresAt: Date.parse(body.expiresAt) };
}

function refreshAgentToken(agentId: string): Promise<AgentTokenEntry> {
  const promise = mintAgentToken(agentId).catch((err) => {
    // Clear the cache so a later attempt can succeed — otherwise one failure
    // would leave this agent permanently unauthenticated.
    if (agentTokenCache.get(agentId) === promise) agentTokenCache.delete(agentId);
    throw err;
  });
  agentTokenCache.set(agentId, promise);
  return promise;
}

/** Fetches (or reuses, or proactively refreshes) the bearer token scoped to one agent. */
async function ensureAgentToken(agentId: string): Promise<string> {
  const existing = agentTokenCache.get(agentId) ?? refreshAgentToken(agentId);
  const entry = await existing;
  if (entry.expiresAt - Date.now() < AGENT_TOKEN_REFRESH_MARGIN_MS) {
    return (await refreshAgentToken(agentId)).token;
  }
  return entry.token;
}

/** Extracts the `agentId` query param `scoped()` appends, without changing any of its ~80 call sites. */
function agentIdFromPath(path: string): string | null {
  const queryIndex = path.indexOf("?");
  if (queryIndex === -1) return null;
  return new URLSearchParams(path.slice(queryIndex + 1)).get("agentId");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const agentId = agentIdFromPath(path);
  const token = await (agentId ? ensureAgentToken(agentId) : ensureApiToken());
  const fetchWith = (bearer: string) =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
        ...init?.headers,
      },
    });
  let res = await fetchWith(token);
  // A scoped call can 401/403 if its token expired or was minted before the
  // agent it names — the master-token path never expires, so it has nothing
  // equivalent to retry here.
  if (!res.ok && agentId && (res.status === 401 || res.status === 403)) {
    agentTokenCache.delete(agentId);
    res = await fetchWith(await ensureAgentToken(agentId));
  }
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
    request<MemoryRecord[]>(scoped(`/memories${status ? `?status=${status}` : ""}`)),
  listMemoryReflections: () => request<MemoryReflectionRecord[]>(scoped("/memory-reflections")),
  createMemory: (body: CreateMemoryRequest) =>
    request<MemoryRecord>(scoped("/memories"), { method: "POST", body: JSON.stringify(body) }),
  updateMemory: (id: string, patch: UpdateMemoryRequest) =>
    request<MemoryRecord>(scoped(`/memories/${id}`), { method: "PATCH", body: JSON.stringify(patch) }),
  listSessions: () => request<SessionRecord[]>(scoped("/sessions")),
  /** Subscription headroom. Not agent-scoped — one Claude account behind them all. */
getSpend: () =>
    request<{ envelopes: SpendEnvelopeRecord[]; ledger: SpendLedgerEntry[] }>(scoped("/spend")),
  setSpendEnvelope: (body: SetSpendEnvelopeRequest) =>
    request<SpendEnvelopeRecord>(scoped("/spend/envelopes"), { method: "PUT", body: JSON.stringify(body) }),
  removeSpendEnvelope: (id: string) =>
    request<void>(`/spend/envelopes/${id}`, { method: "DELETE" }),
  getUsage: () => request<ClaudeUsageSnapshot>("/usage"),
  deleteSession: (id: string) =>
    request<void>(scoped(`/sessions/${id}`), { method: "DELETE" }),

  getChat: (model: ChatModel = "claude") =>
    request<{ session: SessionRecord | null }>(scoped(`/chat?model=${encodeURIComponent(model)}`)),
  sendChat: (
    text: string,
    model: ChatModel = "claude",
    claudeModel?: ClaudeModel,
    autoApproveLocalTools?: boolean
  ) =>
    request<{ sessionId: string; resumed: boolean }>("/chat", {
      method: "POST",
      body: JSON.stringify({
        text,
        model,
        claudeModel,
        autoApproveLocalTools,
        agentId: getActiveAgentId() ?? undefined,
      }),
    }),
  getSession: (id: string) => request<SessionRecord>(scoped(`/sessions/${id}`)),
  createSession: (body: CreateSessionRequest) =>
    request<SessionRecord>("/sessions", {
      method: "POST",
      body: JSON.stringify({ ...body, agentId: getActiveAgentId() ?? undefined }),
    }),
  getSessionEvents: (id: string, since = 0) =>
    request<SessionEventRecord[]>(scoped(`/sessions/${id}/events?since=${since}`)),
  sendMessage: (id: string, text: string) =>
    request<{ ok: boolean; resumed: boolean }>(scoped(`/sessions/${id}/messages`), {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  respondToPermission: (id: string, body: PermissionResponseRequest) =>
    request<{ ok: boolean }>(scoped(`/sessions/${id}/permission-response`), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  interruptSession: (id: string) =>
    request<{ ok: boolean }>(scoped(`/sessions/${id}/interrupt`), { method: "POST" }),

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
    request<TaskRecord>(scoped(`/tasks/${id}`), {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteTask: (id: string) => request<void>(scoped(`/tasks/${id}`), { method: "DELETE" }),

  listMissions: () => request<MissionRecord[]>(scoped("/missions")),
  getMission: (id: string) => request<{ mission: MissionRecord; tasks: TaskRecord[]; deliverables: DeliverableRecord[]; updates: MissionUpdateRecord[] }>(scoped(`/missions/${id}`)),
  createMission: (body: CreateMissionRequest) => request<MissionRecord>("/missions", {
    method: "POST",
    body: JSON.stringify({ ...body, agentId: getActiveAgentId() ?? undefined }),
  }),
  updateMission: (id: string, patch: UpdateMissionRequest) => request<MissionRecord>(scoped(`/missions/${id}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  advanceMission: (id: string) => request<{ mission: MissionRecord; task: TaskRecord; session: SessionRecord }>(scoped(`/missions/${id}/advance`), { method: "POST" }),
  deleteMission: (id: string) => request<void>(scoped(`/missions/${id}`), { method: "DELETE" }),
  listDeliverables: () => request<DeliverableRecord[]>(scoped("/deliverables")),
  createDeliverable: (missionId: string, body: CreateDeliverableRequest) => request<DeliverableRecord>(scoped(`/missions/${missionId}/deliverables`), {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateDeliverable: (id: string, patch: Partial<{ title: string; description: string | null; uri: string | null; status: DeliverableStatus }>) => request<DeliverableRecord>(scoped(`/deliverables/${id}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  deleteDeliverable: (id: string) => request<void>(scoped(`/deliverables/${id}`), { method: "DELETE" }),
  listMissionUpdates: () => request<MissionUpdateRecord[]>(scoped("/mission-updates")),
  reviewMissionUpdate: (id: string, decision: "apply" | "dismiss") => request<{ update: MissionUpdateRecord; mission: MissionRecord }>(scoped(`/mission-updates/${id}/review`), {
    method: "POST",
    body: JSON.stringify({ decision }),
  }),

  getEvolution: () => request<EvolutionOverview>(scoped("/evolution")),
  createEvolutionProposal: (body: CreateEvolutionProposalRequest) => request<EvolutionProposalRecord>(scoped("/evolution/proposals"), {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateEvolutionProposal: (id: string, patch: Partial<CreateEvolutionProposalRequest & { stage: "observed" | "planned" }>) => request<EvolutionProposalRecord>(scoped(`/evolution/proposals/${id}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  updateEvolutionPolicy: (changeClass: EvolutionChangeClass, autonomy: EvolutionAutonomy) => request(`/evolution/policies/${changeClass}`, {
    method: "PATCH",
    body: JSON.stringify({ autonomy }),
  }),
  startEvolutionBuild: (id: string) => request<{ proposal: EvolutionProposalRecord; session: SessionRecord }>(scoped(`/evolution/proposals/${id}/start-build`), { method: "POST" }),
  promoteEvolutionProposal: (id: string) => request<{ ok: boolean; proposal: EvolutionProposalRecord }>(scoped(`/evolution/proposals/${id}/promote`), { method: "POST" }),

  getWorkflows: () => request<WorkflowOverview>(scoped("/workflows")),
  getWorkflow: (id: string) => request<{ workflow: WorkflowRecord; content: ContentItemRecord[]; generationRuns: WorkflowGenerationRunRecord[]; publicationRuns: ContentPublicationRunRecord[] }>(scoped(`/workflows/${id}`)),
  createWorkflow: (body: CreateWorkflowRequest) => request<WorkflowRecord>(scoped("/workflows"), {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateWorkflow: (id: string, patch: UpdateWorkflowRequest) => request<WorkflowRecord>(scoped(`/workflows/${id}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  saveWorkflowCharacter: (workflowId: string, body: SaveWorkflowCharacterRequest) =>
    request<WorkflowCharacterRecord>(scoped(`/workflows/${workflowId}/character`), {
      method: "PUT",
      body: JSON.stringify(body),
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
    request<{ workflowId: string; connectionId: string }>(scoped(`/workflows/${workflowId}/accounts`), {
      method: "POST",
      body: JSON.stringify({ connectionId }),
    }),
  detachWorkflowAccount: (workflowId: string, connectionId: string) =>
    request<void>(scoped(`/workflows/${workflowId}/accounts/${connectionId}`), { method: "DELETE" }),
  deleteWorkflow: (id: string) => request<void>(scoped(`/workflows/${id}`), { method: "DELETE" }),
  createContentItem: (workflowId: string, body: CreateContentItemRequest) => request<ContentItemRecord>(scoped(`/workflows/${workflowId}/content`), {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateContentItem: (id: string, patch: UpdateContentItemRequest) => request<ContentItemRecord>(scoped(`/content/${id}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  deleteContentItem: (id: string) => request<void>(scoped(`/content/${id}`), { method: "DELETE" }),
  publishContentItem: (id: string) => request<{ sessionId: string; runId: string }>(scoped(`/content/${id}/publish`), { method: "POST" }),
  generateWorkflowContent: (id: string, body: GenerateWorkflowContentRequest) => request<{ workflow: WorkflowRecord; session: SessionRecord; generationRun: WorkflowGenerationRunRecord }>(scoped(`/workflows/${id}/generate`), {
    method: "POST",
    body: JSON.stringify(body),
  }),

  getPaidGrowth: () => request<PaidGrowthOverview>(scoped("/paid-growth")),
  getTrends: () => request<TrendsOverview>(scoped("/insights/trends")),
  createPaidGrowthCampaign: (body: CreatePaidGrowthCampaignRequest) =>
    request<PaidGrowthCampaignRecord>(scoped("/paid-growth/workflows"), { method: "POST", body: JSON.stringify(body) }),
  updatePaidGrowthCampaign: (id: string, patch: UpdatePaidGrowthCampaignRequest) =>
    request<PaidGrowthCampaignRecord>(scoped(`/paid-growth/workflows/${id}`), { method: "PATCH", body: JSON.stringify(patch) }),
  updatePaidGrowthPerformance: (id: string, body: UpdatePaidGrowthPerformanceRequest) =>
    request<PaidGrowthCampaignRecord>(scoped(`/paid-growth/workflows/${id}/performance`), { method: "POST", body: JSON.stringify(body) }),
  syncPaidGrowthCampaign: (id: string) =>
    request<{ campaign: PaidGrowthCampaignRecord; decisions: PaidGrowthDecisionRecord[]; overview: PaidGrowthOverview }>(scoped(`/paid-growth/workflows/${id}/sync`), { method: "POST" }),
  requestPaidGrowthLaunch: (id: string) =>
    request<PaidGrowthDecisionRecord>(scoped(`/paid-growth/workflows/${id}/request-launch`), { method: "POST" }),
  refreshPaidGrowthRecommendations: () =>
    request<{ created: PaidGrowthDecisionRecord[]; overview: PaidGrowthOverview }>(scoped("/paid-growth/recommendations/refresh"), { method: "POST" }),
  reviewPaidGrowthDecision: (id: string, decision: "approve" | "reject") =>
    request<{ decision: PaidGrowthDecisionRecord; overview: PaidGrowthOverview }>(scoped(`/paid-growth/decisions/${id}/review`), { method: "POST", body: JSON.stringify({ decision }) }),
  getPaidGrowthHistory: (id: string) =>
    request<MeasurementFactRecord[]>(scoped(`/paid-growth/workflows/${id}/history`)),
  getCampaignExperiments: () =>
    request<CampaignExperimentsOverview>(scoped("/paid-growth/experiments")),
  createCampaignExperiment: (body: CreateCampaignExperimentRequest) =>
    request<CampaignExperimentRecord>(scoped("/paid-growth/experiments"), { method: "POST", body: JSON.stringify(body) }),
  concludeCampaignExperiment: (id: string) =>
    request<{ experiment: CampaignExperimentRecord; decision: PaidGrowthDecisionRecord | null; overview: CampaignExperimentsOverview }>(scoped(`/paid-growth/experiments/${id}/conclude`), { method: "POST" }),
  abandonCampaignExperiment: (id: string, reason: string) =>
    request<{ experiment: CampaignExperimentRecord; overview: CampaignExperimentsOverview }>(scoped(`/paid-growth/experiments/${id}/abandon`), { method: "POST", body: JSON.stringify({ reason }) }),

  getCustomerOperations: () => request<CustomerOperationsOverview>(scoped("/customer-operations")),
  updateCustomerServicePolicy: (patch: UpdateCustomerServicePolicyRequest) =>
    request<CustomerServicePolicyRecord>("/customer-service-policy", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  createCustomerConversation: (body: CreateCustomerConversationRequest) => request<{
    customer: CustomerRecord;
    conversation: CustomerConversationRecord;
    message: CustomerMessageRecord;
  }>(scoped("/customer-conversations"), { method: "POST", body: JSON.stringify(body) }),
  updateCustomerConversation: (id: string, patch: UpdateCustomerConversationRequest) =>
    request<CustomerConversationRecord>(scoped(`/customer-conversations/${id}`), {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCustomerConversation: (id: string) =>
    request<void>(scoped(`/customer-conversations/${id}`), { method: "DELETE" }),
  updateCustomer: (id: string, patch: UpdateCustomerRequest) =>
    request<CustomerRecord>(scoped(`/customers/${id}`), { method: "PATCH", body: JSON.stringify(patch) }),
  sendCustomerMessage: (id: string, body: CreateCustomerMessageRequest) =>
    request<CustomerMessageRecord>(scoped(`/customer-conversations/${id}/messages`), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  draftCustomerReply: (id: string) => request<{ session: SessionRecord; draft: CustomerReplyDraftRecord }>(
    scoped(`/customer-conversations/${id}/drafts`),
    { method: "POST" }
  ),
  escalateCustomerConversation: (id: string) =>
    request<{ conversation: CustomerConversationRecord; task: TaskRecord }>(
      scoped(`/customer-conversations/${id}/escalate`),
      { method: "POST" }
    ),
  createCustomerFollowUp: (id: string) =>
    request<TaskRecord>(scoped(`/customer-conversations/${id}/follow-up`), { method: "POST" }),

  listScheduledTasks: () => request<ScheduledTaskRecord[]>(scoped("/scheduled-tasks")),
  createScheduledTask: (body: CreateScheduledTaskRequest) =>
    request<ScheduledTaskRecord>("/scheduled-tasks", {
      method: "POST",
      body: JSON.stringify({ ...body, agentId: getActiveAgentId() ?? undefined }),
    }),
  updateScheduledTask: (id: string, patch: UpdateScheduledTaskRequest) =>
    request<ScheduledTaskRecord>(scoped(`/scheduled-tasks/${id}`), {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteScheduledTask: (id: string) =>
    request<void>(scoped(`/scheduled-tasks/${id}`), { method: "DELETE" }),
  rehearseScheduledTask: (id: string) =>
    request<AutomationRehearsal>(scoped(`/scheduled-tasks/${id}/rehearsal`)),

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

  getPlatformSignup: (platformId: string) =>
    request<{ progress: PlatformSignupProgress | null; events: SignupEmailEvent[] }>(
      `/platforms/${platformId}/signup`
    ),
  startPlatformSignup: (platformId: string, body: StartPlatformSignupRequest) =>
    request<PlatformSignupProgress>(`/platforms/${platformId}/signup`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelPlatformSignup: (platformId: string) =>
    request<void>(`/platforms/${platformId}/signup`, { method: "DELETE" }),

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
    request<{ items: NotificationRecord[]; unread: number }>(scoped("/notifications")),
  markNotificationRead: (id: string) =>
    request<{ ok: boolean }>(scoped(`/notifications/${id}/read`), { method: "POST" }),
  markAllNotificationsRead: () =>
    request<{ ok: boolean }>(scoped("/notifications/read-all"), { method: "POST" }),

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
  // Mirrors scoped()'s own condition exactly: /sessions/:id/stream is
  // agent-scoped, so an unscoped call needs the master token instead.
  const token = await (activeAgentId ? ensureAgentToken(activeAgentId) : ensureApiToken());
  const path = scoped(`/sessions/${sessionId}/stream?since=${since}`);
  return `${BASE_URL}${path}&token=${encodeURIComponent(token)}`;
}

export async function globalEventsUrl() {
  const token = await ensureApiToken();
  return `${BASE_URL}/events?token=${encodeURIComponent(token)}`;
}
