import express from "express";
import cors from "cors";
import type { ZodType } from "zod";
import { existsSync, rm, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Request, Response } from "express";
import {
  createSession,
  getSession,
  listSessions,
  listSessionEvents,
  markInterruptedIfActive,
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  linkTaskToSession,
  createScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
  deleteScheduledTask,
  getSettings,
  updateSettings,
  getPrimarySessionId,
  setPrimarySessionId,
  getAgentChatSessionId,
  setAgentChatSessionId,
  deleteSession,
  createMission,
  getMission,
  listMissions,
  updateMission,
  deleteMission,
  listDeliverables,
  createDeliverable,
  updateDeliverable,
  deleteDeliverable,
  getMissionUpdate,
  listMissionUpdates,
  reviewMissionUpdate,
  createEvolutionProposal,
  getEvolutionProposal,
  listEvolutionPolicies,
  listEvolutionProposals,
  updateEvolutionPolicy,
  updateEvolutionProposal,
} from "../db/repo.js";
import {
  startSession,
  sendFollowUp,
  resolvePermission,
  interruptSession,
  activeSessionCount,
  atConcurrencyLimit,
  startIdleReaper,
} from "../sessions/sessionManager.js";
import { getUsageSnapshot } from "../sessions/claudeUsage.js";
import { listEnvelopes, listSpendLedger, removeEnvelope, setEnvelope } from "../billing/envelopes.js";
import { characterBrief, getCharacter, listCharacters, saveCharacter } from "../db/characterRepo.js";
import {
  attachWorkflowAccount,
  detachWorkflowAccount,
  adCampaignCountsByWorkflow,
  insightCountsByWorkflow,
  listWorkflowAccounts,
  metricCountsByWorkflow,
} from "../db/workflowAccountsRepo.js";
import {
  listConnections,
  getConnection,
  getConnectionCredentials,
  getConnectionById,
  getConnectionCredentialsById,
  setConnectionCap,
  resolveConnectionId,
  saveConnection,
  recordTestResult,
  deleteConnection,
  exportAllCredentials,
  importCredentials,
} from "../db/connectionsRepo.js";
import {
  createBackup,
  restoreBackup,
  type BackupBundle,
} from "../security/portableBackup.js";
import { getPlatform, platformDefinitions } from "../platforms/definitions.js";
import { getUsageToday } from "../platforms/spendGuard.js";
import { listImages, imagesFolder, ensureImagesFolder } from "../platforms/media.js";
import {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  notify,
} from "../notifications/notifier.js";
import {
  getStorageStats,
  runMaintenance,
  startMaintenance,
} from "../db/maintenance.js";
import { computeNextRun, startScheduler } from "../scheduler/scheduler.js";
import { globalBus } from "../events/globalBus.js";
import { db } from "../db/db.js";
import { createDatabaseBackup } from "../db/backup.js";
import {
  createScheduledTaskSchema,
  createSessionSchema,
  createTaskSchema,
  formatValidationError,
  messageSchema,
  chatMessageSchema,
  permissionResponseSchema,
  issueStripeCardSchema,
  saveConnectionSchema,
  startPlatformSignupSchema,
  stripeRevealSessionSchema,
  updateScheduledTaskSchema,
  walletSpendSchema,
  grantSpendPermissionSchema,
  updateSettingsSchema,
  updateTaskSchema,
  createMissionSchema,
  updateMissionSchema,
  createDeliverableSchema,
  updateDeliverableSchema,
  reviewMissionUpdateSchema,
  createEvolutionProposalSchema,
  updateEvolutionPolicySchema,
  updateEvolutionProposalSchema,
  attachWorkflowAccountSchema,
  saveWorkflowCharacterSchema,
  setConnectionCapSchema,
  setSpendEnvelopeSchema,
  createWorkflowSchema,
  updateWorkflowSchema,
  createContentItemSchema,
  updateContentItemSchema,
  generateWorkflowContentSchema,
  createAgentSchema,
  updateAgentSchema,
  createConversationSchema,
  conversationMessageSchema,
  createMemorySchema,
  updateMemorySchema,
  createCustomerConversationSchema,
  updateCustomerConversationSchema,
  createCustomerMessageSchema,
  updateCustomerSchema,
  updateCustomerServicePolicySchema,
  createPaidGrowthCampaignSchema,
  updatePaidGrowthCampaignSchema,
  updatePaidGrowthPerformanceSchema,
  reviewPaidGrowthDecisionSchema,
  createCampaignExperimentSchema,
  abandonCampaignExperimentSchema,
  createWebsiteConversationSchema,
  websiteMessageSchema,
} from "./validation.js";
import {
  createPaidGrowthCampaign,
  getPaidGrowthCampaign,
  listPaidGrowthDecisions,
  updatePaidGrowthCampaign,
} from "../db/paidGrowthRepo.js";
import { listMeasurementFacts } from "../db/measurementFactsRepo.js";
import {
  decidePaidGrowthRecommendation,
  paidGrowthOverview,
  recordManualPerformance,
  refreshPaidGrowthRecommendations,
  requestPaidGrowthLaunch,
  syncPaidGrowthCampaign,
} from "../paidGrowth/service.js";
import { abandonExperiment, campaignExperimentsOverview, concludeExperiment, createExperiment } from "../paidGrowth/experimentService.js";
import { startPaidGrowthMonitor } from "../paidGrowth/monitor.js";
import { trendsOverview } from "../insights/trendsService.js";
import { apiToken, isValidToken, tokenFromRequest } from "../security/apiToken.js";
import { isAllowedOrigin, isUnauthenticatedPath } from "./authGuard.js";
import {
  beginAuthentication,
  beginRegistration,
  completeAuthentication,
  completeRegistration,
  endOperatorSession,
  readCookie,
  resolveSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  startOperatorSession,
} from "../security/operatorAuth.js";
import { countOperators } from "../db/operatorRepo.js";
import {
  appendConversationMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversationMessages,
  listConversations,
  listParticipants,
} from "../db/conversationRepo.js";
import {
  isConversationRunning,
  runConversation,
  stopConversation,
} from "../conversations/conversationRunner.js";
import { listMemories, listMemoryReflections, remember, updateMemory } from "../db/memoryRepo.js";
import {
  archiveAgent,
  createAgent,
  getAgent,
  getDefaultAgent,
  listAgents,
  updateAgent,
} from "../db/agentRepo.js";
import {
  ensureEvolutionBootstrap,
  evolutionReadiness,
  labBuildPrompt,
  LAB_PATH,
} from "../evolution/evolutionService.js";
import {
  createWorkflow,
  createWorkflowGenerationRun,
  createContentItem,
  deleteWorkflow,
  deleteContentItem,
  getWorkflow,
  getContentItem,
  listWorkflowGenerationRuns,
  listWorkflows,
  listContentItems,
  listContentPublicationRuns,
  updateWorkflow,
  updateContentItem,
  recoverInterruptedWorkflowRuns,
} from "../db/workflowRepo.js";
import { workflowGenerationPrompt } from "../workflows/contentGeneration.js";
import { startContentPublication } from "../workflows/publicationService.js";
import { startContentPublishingScheduler } from "../workflows/publicationScheduler.js";
import {
  createCustomerConversation,
  createCustomerMessage,
  deleteCustomerConversation,
  getCustomer,
  getCustomerConversation,
  getCustomerServicePolicy,
  listCustomerMessages,
  listCustomerOperations,
  markCustomerReplyDraftUsed,
  updateCustomer,
  updateCustomerConversation,
  updateCustomerServicePolicy,
} from "../db/customerRepo.js";
import { authorizeWebsiteConversation, createWebsiteConversation, sendCustomerReply } from "../customers/channelGateway.js";
import { customerWidgetDemo, customerWidgetScript } from "../customers/widget.js";
import { handleCustomerInbound, startCustomerReplyDraft } from "../customers/customerService.js";
import { handleMetaWebhook, handleXWebhook, ingestResendCustomerEmail, verifyAndFetchResendEmail, verifyMetaWebhook, verifyXWebhook, xCrcResponse } from "../customers/webhooks.js";
import {
  advanceSignupStep,
  clearSignupProgress,
  getSignupProgress,
  handleSignupConfirmationEmail,
  listSignupEmailEvents,
  startPlatformSignup,
} from "../platforms/signupInbox.js";
import {
  cancelStripeCard,
  createCardRevealSession,
  getIssuingBalance,
  issueStripeCard,
  listStripeCards,
} from "../billing/stripeFunding.js";
import {
  getSpenderAddress,
  grantSpendPermission,
  listGrantedPermissions,
  listWalletSpends,
  operatorWalletIsManaged,
  revokeSpendPermission,
  spendFromPermission,
} from "../billing/walletFunding.js";
import { sendAgentChat } from "../agents/agentChat.js";
import { interruptCodexSession, sendCodexFollowUp } from "../sessions/codexSessionManager.js";
import {
  refreshSlackAgentBridge,
  startSlackAgentBridge,
  stopSlackAgentBridge,
} from "../slack/slackAgentBridge.js";
import { startApproveServer } from "./approveServer.js";

const PORT = Number(process.env.PORT ?? 4317);
const HOST = process.env.HOST ?? "127.0.0.1";
/**
 * "localhost" resolves to both `127.0.0.1` and `::1` on a normal dual-stack
 * machine, and a browser that tries the IPv6 address first has no guarantee
 * of falling back to IPv4 quickly — proven live: a real user's Firefox
 * session hung specifically on browser-side calls to the orchestrator (the
 * dashboard's own data loading) while server-to-server calls were fine,
 * and `Test-NetConnection ::1 -Port 4317` confirmed nothing was listening
 * there at all. Binding both loopback addresses removes the race entirely
 * rather than depending on every browser's Happy Eyeballs implementation
 * being fast about it. Only added when HOST is the plain IPv4 loopback —
 * an operator who has overridden HOST to something else is making their own
 * choice here.
 */
const HOST_V6 = process.env.HOST_V6 ?? (HOST === "127.0.0.1" ? "::1" : null);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

/**
 * A second origin for verifying a build without disturbing the running one.
 *
 * The design automation builds its own changes and screenshots them on this
 * port. Without it the preview loads but every fetch is blocked by CORS, so the
 * automation sees a wall of console errors that have nothing to do with its
 * work. Both entries are loopback-only, so this widens nothing beyond the
 * machine itself.
 */
const PREVIEW_ORIGIN = process.env.PREVIEW_ORIGIN ?? "http://localhost:3100";
const ALLOWED_ORIGINS = [
  WEB_ORIGIN,
  PREVIEW_ORIGIN,
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3100",
];

/**
 * A single bad session must never take down the service.
 *
 * The Agent SDK surfaces some failures on promise chains nothing awaits — an
 * unusable cwd rejects inside ProcessTransport.write, for one — and Node's
 * default for an unhandled rejection is to exit. That killed every other running
 * session and every scheduled automation until someone noticed. These handlers
 * log and keep serving instead.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[orchestrator] unhandled rejection (continuing):", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[orchestrator] uncaught exception (continuing):", err);
});

const PASSIVE_FALLBACK = process.env.JARVIS_PASSIVE_FALLBACK === "1";
const CONTENT_PUBLISHING_ENABLED = !PASSIVE_FALLBACK || process.env.JARVIS_ENABLE_CONTENT_PUBLISHING === "1";

// A previous orchestrator process may have died mid-session; those sessions
// can't be reattached, so surface them as interrupted rather than stuck "running".
// A temporary passive fallback shares the live database with the scheduled
// service, so it must never rewrite session state simply because it started.
if (!PASSIVE_FALLBACK) markInterruptedIfActive();
recoverInterruptedWorkflowRuns();

const app = express();
app.use("/widget", (req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  const ownOrigin = `${req.protocol}://${req.get("host")}`;
  const allowed = getCustomerServicePolicy().allowedOrigins;
  if (origin && origin !== ownOrigin && !allowed.includes("*") && !allowed.includes(origin)) {
    res.status(403).json({ error: "This website origin is not allowed to use the Jarvis chat widget." });
    return;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") { res.status(204).send(); return; }
  next();
});
// `credentials: true` lets the browser send/receive the operator session
// cookie across the :3000/:4317 port split — cookies are host-scoped, not
// port-scoped, but a cross-origin fetch still needs the server's explicit
// opt-in (and a non-wildcard origin, which ALLOWED_ORIGINS already is) before
// the browser will attach or accept one.
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buffer) => { (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); },
}));

// The widget runs its own origin allowlist above, for third-party sites.
app.use((req: Request, res: Response, next) => {
  if (req.path.startsWith("/widget")) return next();
  if (isAllowedOrigin(req.headers.origin, ALLOWED_ORIGINS)) return next();
  res.status(403).json({ error: "Origin not allowed" });
});

app.use((req: Request, res: Response, next) => {
  if (isUnauthenticatedPath(req.path)) return next();
  // Preflight carries no credentials by design; the cors middleware above has
  // already decided whether the origin may proceed to the real request.
  if (req.method === "OPTIONS") return next();
  if (isValidToken(tokenFromRequest(req))) return next();
  res.status(401).json({
    error:
      "Missing or invalid API token. The dashboard reads it automatically; a script must send it as a Bearer token.",
  });
});

function rawBody(req: Request): Buffer {
  return (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
}

function validatedBody<T>(schema: ZodType<T>, req: Request, res: Response): T | undefined {
  const result = schema.safeParse(req.body);
  if (result.success) return result.data;
  res.status(400).json({ error: formatValidationError(result.error) });
  return undefined;
}

function validatedSince(req: Request, res: Response): number | undefined {
  const value = Number(req.query.since ?? 0);
  if (Number.isSafeInteger(value) && value >= 0) return value;
  res.status(400).json({ error: "since must be a non-negative integer" });
  return undefined;
}

function sseHeaders(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // EventSource does not report `open` until the headers are actually on the
  // wire. Without an explicit flush the dashboard can say "Connecting" until
  // the first 15-second heartbeat even though the service is healthy.
  res.flushHeaders();
}

function sseSend(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get("/health", (_req: Request, res: Response) => {
  db.prepare("SELECT 1").get();
  res.json({ ok: true, activeSessions: activeSessionCount(), time: new Date().toISOString() });
});

app.post("/shutdown", (_req: Request, res: Response) => {
  res.status(202).json({ ok: true });
  // Let the response flush before closing the listener and marking active work
  // interrupted. This gives the service wrapper a reliable graceful-stop path.
  setImmediate(shutdown);
});

// ---- Auth ----
//
// Replaces "anyone who can reach this dashboard is already the operator"
// (see `security/apiToken.ts`) with a real login: a passkey proves a browser
// belongs to the human who set this install up, gating the dashboard itself
// rather than just the API calls it makes once inside. These routes are
// unauthenticated by necessity (see `authGuard.ts`'s `/auth` entry) — a
// browser without a session cookie yet still needs to reach them to get one.
// The bearer-token model below is untouched: it keeps proving "this caller
// is the dashboard," which is a different question from "this browser is the
// operator."

function currentOperator(req: Request) {
  return resolveSession(readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
}

/** A human-readable hint for which browser a session belongs to, shown nowhere yet but stored for later device-management UI. */
function userAgentLabel(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 200) : undefined;
}

app.get("/auth/status", (_req: Request, res: Response) => {
  res.json({ hasOperator: countOperators() > 0 });
});

app.get("/auth/session", (req: Request, res: Response) => {
  const operator = currentOperator(req);
  if (!operator) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  res.json({ operator: { id: operator.id, displayName: operator.displayName } });
});

app.post("/auth/logout", (req: Request, res: Response) => {
  endOperatorSession(readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

app.post("/auth/webauthn/register/options", async (req: Request, res: Response) => {
  try {
    // Bootstrapping the first operator has no session yet; adding a second
    // passkey to an existing operator does — `beginRegistration` re-checks
    // both cases itself rather than trusting which branch the caller reached.
    const actingOperator = currentOperator(req);
    const { ceremonyId, options } = await beginRegistration(actingOperator?.id ?? null);
    res.json({ ceremonyId, options });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Could not start registration" });
  }
});

app.post("/auth/webauthn/register/verify", async (req: Request, res: Response) => {
  const body = req.body as {
    ceremonyId?: unknown;
    response?: unknown;
    displayName?: unknown;
    deviceLabel?: unknown;
  };
  if (typeof body.ceremonyId !== "string" || typeof body.response !== "object" || body.response === null) {
    res.status(400).json({ error: "Malformed registration response" });
    return;
  }
  try {
    const { operator } = await completeRegistration({
      ceremonyId: body.ceremonyId,
      response: body.response as Parameters<typeof completeRegistration>[0]["response"],
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel : undefined,
    });
    const session = startOperatorSession(operator.id, userAgentLabel(req));
    res.cookie(SESSION_COOKIE_NAME, session.id, sessionCookieOptions());
    res.status(201).json({ operator: { id: operator.id, displayName: operator.displayName } });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Registration failed" });
  }
});

app.post("/auth/webauthn/login/options", async (_req: Request, res: Response) => {
  try {
    const { ceremonyId, options } = await beginAuthentication();
    res.json({ ceremonyId, options });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not start login" });
  }
});

app.post("/auth/webauthn/login/verify", async (req: Request, res: Response) => {
  const body = req.body as { ceremonyId?: unknown; response?: unknown };
  if (typeof body.ceremonyId !== "string" || typeof body.response !== "object" || body.response === null) {
    res.status(400).json({ error: "Malformed login response" });
    return;
  }
  try {
    const result = await completeAuthentication({
      ceremonyId: body.ceremonyId,
      response: body.response as Parameters<typeof completeAuthentication>[0]["response"],
    });
    const session = startOperatorSession(result.operatorId, userAgentLabel(req));
    res.cookie(SESSION_COOKIE_NAME, session.id, sessionCookieOptions());
    res.json({ operator: { id: result.operatorId, displayName: result.displayName } });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Login failed" });
  }
});

// ---- Sessions ----

/**
 * The agent a request is scoped to.
 *
 * Absent means "every agent" for listings, and the default agent for creates —
 * so a caller that predates v2, or a script that does not care, still works.
 * An unknown id is rejected rather than silently widened to everything, which
 * would turn a typo into a cross-agent data leak.
 */
function scopedAgentId(req: Request, res: Response): string | undefined | null {
  const raw = req.query.agentId ?? (req.body as { agentId?: unknown } | undefined)?.agentId;
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" || !getAgent(raw)) {
    res.status(400).json({ error: "Unknown agent" });
    return null;
  }
  return raw;
}

/** Creates fall back to the default agent so nothing is ever left unowned. */
function owningAgentId(req: Request, res: Response): string | undefined | null {
  const scoped = scopedAgentId(req, res);
  if (scoped === null) return null;
  return scoped ?? getDefaultAgent()?.id;
}

app.post("/sessions", (req: Request, res: Response) => {
  const body = validatedBody(createSessionSchema, req, res);
  if (!body) return;
  // Caught here rather than at launch: an unusable cwd surfaces deep inside the
  // SDK's transport as an async failure, which is far harder to attribute.
  if (!existsSync(body.cwd) || !statSync(body.cwd).isDirectory()) {
    res.status(400).json({
      error: `Working directory does not exist: ${body.cwd}`,
    });
    return;
  }
  if (atConcurrencyLimit()) {
    res.status(429).json({
      error: `Too many sessions running at once (${activeSessionCount()}/${getSettings().maxConcurrentSessions}). Wait for one to finish, or raise the limit in Settings.`,
    });
    return;
  }
  const agentId = owningAgentId(req, res);
  if (agentId === null) return;
  const session = createSession({
    title: body.prompt.slice(0, 120),
    cwd: body.cwd,
    permissionMode: body.permissionMode ?? "default",
    allowedTools: body.allowedTools,
    taskId: body.taskId,
    agentId,
  });
  if (body.taskId) {
    linkTaskToSession(body.taskId, session.id);
  }
  globalBus.emit("session_updated", session.id);

  // Fire-and-forget: runs for the lifetime of the session, independent of this request.
  void startSession({
    id: session.id,
    prompt: body.prompt,
    cwd: body.cwd,
    permissionMode: body.permissionMode ?? "default",
    allowedTools: body.allowedTools,
    title: session.title,
    agentId,
  });

  res.status(201).json(session);
});

app.get("/sessions", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res);
  if (agentId === null) return;
  res.json(listSessions(agentId));
});

/**
 * One ongoing conversation per agent.
 *
 * Resumes the agent's existing thread rather than starting another one, so
 * talking to it on Monday and Thursday is one conversation with memory instead
 * of two strangers. Automation runs deliberately keep their own sessions — each
 * really is a separate execution.
 */
app.get("/chat", (req: Request, res: Response) => {
  const agentId = owningAgentId(req, res);
  if (agentId === null) return;
  const model = req.query.model === "gpt-5.6-sol" ? "gpt-5.6-sol" : "claude";
  const id = agentId ? getAgentChatSessionId(agentId, model) : getPrimarySessionId();
  const session = id ? getSession(id) : undefined;
  res.json({ session: session ?? null });
});

app.post("/chat", (req: Request, res: Response) => {
  const body = validatedBody(chatMessageSchema, req, res);
  if (!body) return;
  const { text, model, claudeModel, autoApproveLocalTools } = body;

  const agentId = owningAgentId(req, res);
  if (agentId === null) return;
  if (!agentId) { res.status(503).json({ error: "No default agent is available." }); return; }
  const outcome = sendAgentChat(agentId, text, model, claudeModel, autoApproveLocalTools);
  if (!outcome.ok) {
    res.status(outcome.reason === "at_capacity" ? 429 : outcome.reason === "busy" ? 409 : outcome.reason === "agent_not_found" ? 404 : 400)
      .json({ error: outcome.message });
    return;
  }
  res.status(outcome.resumed ? 202 : 201).json({ sessionId: outcome.sessionId, resumed: outcome.resumed });
});

/**
 * Subscription headroom for the Claude account these sessions run on.
 *
 * Not agent-scoped: there is one Claude account behind every agent, so the
 * answer is the same whoever is asking.
 */
/**
 * Money limits per rail, and the ledger of what was actually spent.
 *
 * A rail with no envelope refuses to spend at all, so these are the switch that
 * turns paid capability on rather than a ceiling on something already running.
 */
app.get("/spend", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json({ envelopes: listEnvelopes(agentId), ledger: listSpendLedger(100, agentId) });
});

app.put("/spend/envelopes", (req: Request, res: Response) => {
  const body = validatedBody(setSpendEnvelopeSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json(setEnvelope({ ...body, agentId }));
});

app.delete("/spend/envelopes/:id", (req: Request, res: Response) => {
  removeEnvelope(req.params.id);
  res.status(204).send();
});

app.get("/usage", (_req: Request, res: Response) => {
  res.json(getUsageSnapshot());
});

app.delete("/sessions/:id", (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!session || (agentId && session.agentId !== agentId)) {
    res.status(404).json({ error: "no such session" });
    return;
  }
  if (["running", "starting", "waiting_permission"].includes(session.status)) {
    res.status(409).json({ error: "Session is still running. Interrupt it first." });
    return;
  }
  deleteSession(req.params.id);
  globalBus.emit("session_updated", req.params.id);
  globalBus.emit("memories_changed");
  res.status(204).send();
});

app.get("/sessions/:id", (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!session || (agentId && session.agentId !== agentId)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(session);
});

app.get("/sessions/:id/events", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getSession(req.params.id)?.agentId !== agentId) { res.status(404).json({ error: "not found" }); return; }
  const since = validatedSince(req, res);
  if (since === undefined) return;
  res.json(listSessionEvents(req.params.id, since));
});

app.get("/sessions/:id/stream", (req: Request, res: Response) => {
  const sessionId = req.params.id;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getSession(sessionId)?.agentId !== agentId) { res.status(404).json({ error: "not found" }); return; }
  const since = validatedSince(req, res);
  if (since === undefined) return;
  sseHeaders(res);

  // Replay anything persisted since the client's last-seen seq, then tail live events.
  for (const event of listSessionEvents(sessionId, since)) {
    sseSend(res, "session-event", event);
  }

  // Listen on the durable process-wide path, not the current session handle.
  // An idle handle can be reaped and replaced while this browser connection
  // remains open; the new run must still stream into the same transcript.
  const onEvent = (event: { sessionId?: string }) => {
    if (event.sessionId === sessionId) sseSend(res, "session-event", event);
  };
  globalBus.on("session_event", onEvent);

  // A named heartbeat lets the client distinguish a healthy idle stream from a
  // half-open socket without polling the transcript database.
  const heartbeat = setInterval(
    () => sseSend(res, "session-heartbeat", { time: new Date().toISOString() }),
    2_000
  );

  req.on("close", () => {
    clearInterval(heartbeat);
    globalBus.off("session_event", onEvent);
  });
});

// ---- Agents ----

app.get("/agents", (req: Request, res: Response) => {
  const status = req.query.status;
  if (status !== undefined && status !== "active" && status !== "archived") {
    res.status(400).json({ error: "status must be active or archived" });
    return;
  }
  res.json(listAgents(status as "active" | "archived" | undefined));
});

app.get("/agents/:id", (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return;
  }
  res.json(agent);
});

app.post("/agents", (req: Request, res: Response) => {
  const body = validatedBody(createAgentSchema, req, res);
  if (!body) return;
  // Same check the session launcher makes, and for the same reason: an unusable
  // cwd surfaces deep inside the SDK transport where it is hard to attribute.
  if (body.cwd && (!existsSync(body.cwd) || !statSync(body.cwd).isDirectory())) {
    res.status(400).json({ error: `Working directory does not exist: ${body.cwd}` });
    return;
  }
  const agent = createAgent(body);
  globalBus.emit("agents_changed");
  res.status(201).json(agent);
});

app.patch("/agents/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateAgentSchema, req, res);
  if (!body) return;
  if (body.cwd && (!existsSync(body.cwd) || !statSync(body.cwd).isDirectory())) {
    res.status(400).json({ error: `Working directory does not exist: ${body.cwd}` });
    return;
  }
  const agent = updateAgent(req.params.id, body);
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return;
  }
  globalBus.emit("agents_changed");
  res.json(agent);
});

/**
 * Archives rather than deletes — an agent's runs, missions, and customers point
 * at it, and removing the row would leave that history owned by nobody.
 */
app.delete("/agents/:id", (req: Request, res: Response) => {
  const outcome = archiveAgent(req.params.id);
  if (!outcome.ok) {
    if (outcome.reason === "unknown_agent") {
      res.status(404).json({ error: "agent not found" });
      return;
    }
    res.status(409).json({
      error: "This is the only active agent. Create another before archiving it.",
    });
    return;
  }
  globalBus.emit("agents_changed");
  res.json(outcome.agent);
});

// ---- Agent conversations ----

app.get("/conversations", (_req: Request, res: Response) => {
  res.json(listConversations());
});

app.get("/conversations/:id", (req: Request, res: Response) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  res.json({
    conversation,
    participants: listParticipants(conversation.id),
    messages: listConversationMessages(conversation.id),
  });
});

app.post("/conversations", (req: Request, res: Response) => {
  const body = validatedBody(createConversationSchema, req, res);
  if (!body) return;
  const unknown = body.agentIds.filter((id) => !getAgent(id));
  if (unknown.length) {
    res.status(400).json({ error: "One or more agents do not exist." });
    return;
  }
  const conversation = createConversation(body);
  globalBus.emit("conversations_changed");
  res.status(201).json(conversation);
});

app.post("/conversations/:id/start", (req: Request, res: Response) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  if (isConversationRunning(conversation.id)) {
    res.status(409).json({ error: "This conversation is already running." });
    return;
  }
  if (conversation.turnsUsed >= conversation.turnCap) {
    res.status(409).json({
      error: "This conversation has used all of its turns. Create a new one to continue.",
    });
    return;
  }
  // Fire-and-forget: the room runs for as long as its caps allow, independent
  // of this request.
  void runConversation(conversation.id);
  res.status(202).json({ ok: true });
});

app.post("/conversations/:id/stop", async (req: Request, res: Response) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  await stopConversation(conversation.id);
  res.json(getConversation(conversation.id));
});

/** Lets a human interject between turns rather than only watching. */
app.post("/conversations/:id/messages", (req: Request, res: Response) => {
  const body = validatedBody(conversationMessageSchema, req, res);
  if (!body) return;
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  const message = appendConversationMessage({
    conversationId: conversation.id,
    turn: conversation.turnsUsed,
    speakerAgentId: null,
    speakerName: "You",
    body: body.text,
  });
  globalBus.emit("conversations_changed");
  res.status(201).json(message);
});

app.delete("/conversations/:id", async (req: Request, res: Response) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  // Stop first: deleting a room out from under a running turn would leave the
  // loop writing to rows that no longer exist.
  if (isConversationRunning(conversation.id)) await stopConversation(conversation.id);
  deleteConversation(conversation.id);
  globalBus.emit("conversations_changed");
  res.status(204).end();
});

// ---- Durable memory ----

app.get("/memories", (req: Request, res: Response) => {
  const status = req.query.status;
  if (status !== undefined && status !== "active" && status !== "archived") {
    res.status(400).json({ error: "status must be active or archived" });
    return;
  }
  const agentId = scopedAgentId(req, res);
  if (agentId === null) return;
  res.json(listMemories(status as "active" | "archived" | undefined, agentId));
});

app.get("/memory-reflections", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json(listMemoryReflections(20, agentId));
});

app.post("/memories", (req: Request, res: Response) => {
  const body = validatedBody(createMemorySchema, req, res);
  if (!body) return;
  const owner = owningAgentId(req, res);
  if (owner === null) return;
  // Shared memories have no owner; that absence is what makes them visible to
  // every agent.
  const result = remember({ ...body, agentId: body.shared ? null : owner });
  globalBus.emit("memories_changed");
  res.status(result.created ? 201 : 200).json(result.memory);
});

app.patch("/memories/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateMemorySchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && !listMemories(undefined, agentId).some((item) => item.id === req.params.id)) {
    res.status(404).json({ error: "memory not found" }); return;
  }
  try {
    const memory = updateMemory(req.params.id, body);
    if (!memory) {
      res.status(404).json({ error: "memory not found" });
      return;
    }
    globalBus.emit("memories_changed");
    res.json(memory);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Customer operations ----

app.get("/widget/customer-chat.js", (_req: Request, res: Response) => {
  res.type("application/javascript").set("Cache-Control", "no-store").send(customerWidgetScript(getCustomerServicePolicy()));
});

app.get("/widget/demo", (req: Request, res: Response) => {
  res.type("html").send(customerWidgetDemo(`${req.protocol}://${req.get("host")}`));
});

app.get("/widget/config", (_req: Request, res: Response) => {
  const policy = getCustomerServicePolicy();
  res.json({ name: policy.widgetName, welcome: policy.widgetWelcome });
});

app.post("/widget/conversations", (req: Request, res: Response) => {
  const body = validatedBody(createWebsiteConversationSchema, req, res);
  if (!body) return;
  const created = createWebsiteConversation(body);
  globalBus.emit("customers_changed");
  handleCustomerInbound(created.conversationId, body.body);
  res.status(201).json({ conversationId: created.conversationId, token: created.token });
});

app.get("/widget/conversations/:id", (req: Request, res: Response) => {
  const token = String(req.query.token ?? "");
  if (!authorizeWebsiteConversation(req.params.id, token)) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  res.json({ messages: listCustomerMessages(req.params.id).filter((message) => message.direction !== "internal") });
});

app.post("/widget/conversations/:id/messages", (req: Request, res: Response) => {
  const body = validatedBody(websiteMessageSchema, req, res);
  if (!body) return;
  if (!authorizeWebsiteConversation(req.params.id, body.token)) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  const message = createCustomerMessage({ conversationId: req.params.id, direction: "inbound", sender: "customer", body: body.body });
  globalBus.emit("customers_changed");
  handleCustomerInbound(req.params.id, body.body);
  res.status(201).json(message);
});

app.post("/webhooks/resend", async (req: Request, res: Response) => {
  const creds = getConnectionCredentials("resend");
  if (!creds?.webhookSecret) { res.status(503).json({ error: "Resend receiving is not configured." }); return; }
  try {
    const headers = {
      "svix-id": String(req.headers["svix-id"] ?? ""),
      "svix-timestamp": String(req.headers["svix-timestamp"] ?? ""),
      "svix-signature": String(req.headers["svix-signature"] ?? ""),
    };
    const email = await verifyAndFetchResendEmail(rawBody(req), headers, creds);
    // One Resend webhook URL covers every address on the connected domain —
    // an in-progress platform signup claims its own confirmation mail here
    // before it ever reaches the customer-support path below.
    if (email && handleSignupConfirmationEmail(email)) {
      globalBus.emit("platform_signup_changed");
    } else if (email && ingestResendCustomerEmail(email)) {
      globalBus.emit("customers_changed");
    }
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[customers] rejected Resend webhook:", error);
    res.status(401).json({ error: "Invalid webhook." });
  }
});

app.get("/webhooks/x", (req: Request, res: Response) => {
  const secret = getConnectionCredentials("x")?.apiSecret;
  const token = String(req.query.crc_token ?? "");
  if (!secret || !token) { res.status(400).json({ error: "X webhook verification is not configured." }); return; }
  res.json({ response_token: xCrcResponse(secret, token) });
});

app.post("/webhooks/x", (req: Request, res: Response) => {
  const creds = getConnectionCredentials("x");
  const signature = String(req.headers["x-twitter-webhooks-signature"] ?? "");
  const raw = rawBody(req);
  if (!creds?.apiSecret || !verifyXWebhook(creds.apiSecret, raw, signature)) {
    res.status(401).json({ error: "Invalid webhook signature." }); return;
  }
  const count = handleXWebhook(raw, creds);
  if (count) globalBus.emit("customers_changed");
  res.status(200).json({ received: true });
});

for (const channel of ["facebook", "instagram"] as const) {
  app.get(`/webhooks/${channel}`, (req: Request, res: Response) => {
    const creds = getConnectionCredentials(channel);
    if (String(req.query["hub.mode"] ?? "") !== "subscribe" || !creds?.verifyToken || String(req.query["hub.verify_token"] ?? "") !== creds.verifyToken) {
      res.status(403).send("Verification failed."); return;
    }
    res.status(200).send(String(req.query["hub.challenge"] ?? ""));
  });
  app.post(`/webhooks/${channel}`, (req: Request, res: Response) => {
    const creds = getConnectionCredentials(channel);
    const raw = rawBody(req);
    if (!creds?.appSecret || !verifyMetaWebhook(creds.appSecret, raw, String(req.headers["x-hub-signature-256"] ?? ""))) {
      res.status(401).json({ error: "Invalid webhook signature." }); return;
    }
    const count = handleMetaWebhook(raw, channel);
    if (count) globalBus.emit("customers_changed");
    res.status(200).send("EVENT_RECEIVED");
  });
}

app.get("/customer-operations", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json(listCustomerOperations(agentId));
});

app.patch("/customer-service-policy", (req: Request, res: Response) => {
  const body = validatedBody(updateCustomerServicePolicySchema, req, res);
  if (!body) return;
  const policy = updateCustomerServicePolicy(body);
  globalBus.emit("customers_changed");
  res.json(policy);
});

app.post("/customer-conversations", (req: Request, res: Response) => {
  const body = validatedBody(createCustomerConversationSchema, req, res);
  if (!body) return;
  const agentId = owningAgentId(req, res); if (agentId === null) return;
  const created = createCustomerConversation({ ...body, agentId });
  globalBus.emit("customers_changed");
  res.status(201).json(created);
});

app.patch("/customer-conversations/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateCustomerConversationSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getCustomerConversation(req.params.id, agentId)) { res.status(404).json({ error: "conversation not found" }); return; }
  const conversation = updateCustomerConversation(req.params.id, body);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  globalBus.emit("customers_changed");
  res.json(conversation);
});

app.delete("/customer-conversations/:id", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getCustomerConversation(req.params.id, agentId)) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  deleteCustomerConversation(req.params.id);
  globalBus.emit("customers_changed");
  res.status(204).send();
});

app.patch("/customers/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateCustomerSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getCustomer(req.params.id, agentId)) { res.status(404).json({ error: "customer not found" }); return; }
  const customer = updateCustomer(req.params.id, body);
  if (!customer) {
    res.status(404).json({ error: "customer not found" });
    return;
  }
  globalBus.emit("customers_changed");
  res.json(customer);
});

app.post("/customer-conversations/:id/messages", async (req: Request, res: Response) => {
  const body = validatedBody(createCustomerMessageSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getCustomerConversation(req.params.id, agentId)) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  try {
    const conversation = getCustomerConversation(req.params.id)!;
    const message = await sendCustomerReply({ conversationId: conversation.id, channel: conversation.channel, body: body.body, sender: body.sender ?? "operator", draftId: body.draftId });
    if (body.draftId) markCustomerReplyDraftUsed(body.draftId);
    globalBus.emit("customers_changed");
    res.status(201).json(message);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/customer-conversations/:id/drafts", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getCustomerConversation(req.params.id, agentId)) { res.status(404).json({ error: "Conversation not found." }); return; }
  try {
    res.status(201).json(startCustomerReplyDraft(req.params.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(message === "Conversation not found." ? 404 : 400).json({ error: message });
  }
});

app.post("/customer-conversations/:id/escalate", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const conversation = getCustomerConversation(req.params.id, agentId);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  const customer = getCustomer(conversation.customerId);
  const updated = updateCustomerConversation(conversation.id, {
    assignedTo: "human",
    priority: conversation.priority === "urgent" ? "urgent" : "high",
    status: "open",
  })!;
  createCustomerMessage({
    conversationId: conversation.id,
    direction: "internal",
    sender: "system",
    body: "Escalated for human review.",
  });
  const task = createTask({
    title: `Customer escalation: ${conversation.subject}`,
    description: `Review the ${conversation.channel} conversation with ${customer?.name ?? "customer"}. Open Customer Operations and resolve or reply.`,
    agentId,
  });
  notify({
    type: "customer_escalation",
    severity: "warning",
    title: `Customer needs attention: ${customer?.name ?? conversation.subject}`,
    body: conversation.subject,
    agentId,
  });
  globalBus.emit("customers_changed");
  globalBus.emit("missions_changed");
  res.status(201).json({ conversation: updated, task });
});

app.post("/customer-conversations/:id/follow-up", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const conversation = getCustomerConversation(req.params.id, agentId);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  const customer = getCustomer(conversation.customerId);
  const task = createTask({
    title: `Follow up with ${customer?.name ?? "customer"}`,
    description: `${conversation.subject} · ${conversation.channel} · Customer Operations`,
    agentId,
  });
  createCustomerMessage({
    conversationId: conversation.id,
    direction: "internal",
    sender: "system",
    body: "Follow-up task created.",
  });
  globalBus.emit("customers_changed");
  globalBus.emit("missions_changed");
  res.status(201).json(task);
});

app.get("/events", (req: Request, res: Response) => {
  sseHeaders(res);

  const onUpdate = (sessionId: string) => {
    const session = getSession(sessionId);
    if (session) sseSend(res, "session-updated", session);
  };
  globalBus.on("session_updated", onUpdate);

  const onNotifications = () => sseSend(res, "notifications-changed", { unread: unreadCount() });
  globalBus.on("notifications_changed", onNotifications);

  const onMissions = () => sseSend(res, "missions-changed", {});
  globalBus.on("missions_changed", onMissions);

  const onEvolution = () => sseSend(res, "evolution-changed", {});
  globalBus.on("evolution_changed", onEvolution);
  const onCampaigns = () => sseSend(res, "workflows-changed", {});
  globalBus.on("workflows_changed", onCampaigns);
  const onMemories = () => sseSend(res, "memories-changed", {});
  globalBus.on("memories_changed", onMemories);
  const onAutomations = () => sseSend(res, "automations-changed", {});
  globalBus.on("automations_changed", onAutomations);
  const onChat = () => sseSend(res, "chat-changed", {});
  globalBus.on("chat_changed", onChat);
  const onCustomers = () => sseSend(res, "customers-changed", {});
  globalBus.on("customers_changed", onCustomers);
  const onPaidGrowth = () => sseSend(res, "paid-growth-changed", {});
  globalBus.on("paid_growth_changed", onPaidGrowth);
  const onAgents = () => sseSend(res, "agents-changed", {});
  globalBus.on("agents_changed", onAgents);
  const onConversations = () => sseSend(res, "conversations-changed", {});
  globalBus.on("conversations_changed", onConversations);
  const onPlatformSignup = () => sseSend(res, "platform-signup-changed", {});
  globalBus.on("platform_signup_changed", onPlatformSignup);
  const onClaudeUsage = () => sseSend(res, "claude-usage-changed", getUsageSnapshot());
  globalBus.on("claude_usage_changed", onClaudeUsage);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    globalBus.off("session_updated", onUpdate);
    globalBus.off("notifications_changed", onNotifications);
    globalBus.off("missions_changed", onMissions);
    globalBus.off("evolution_changed", onEvolution);
    globalBus.off("workflows_changed", onCampaigns);
    globalBus.off("memories_changed", onMemories);
    globalBus.off("automations_changed", onAutomations);
    globalBus.off("chat_changed", onChat);
    globalBus.off("customers_changed", onCustomers);
    globalBus.off("paid_growth_changed", onPaidGrowth);
    globalBus.off("agents_changed", onAgents);
    globalBus.off("conversations_changed", onConversations);
    globalBus.off("platform_signup_changed", onPlatformSignup);
    globalBus.off("claude_usage_changed", onClaudeUsage);
  });
});

app.post("/sessions/:id/messages", (req: Request, res: Response) => {
  const body = validatedBody(messageSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getSession(req.params.id)?.agentId !== agentId) { res.status(404).json({ error: "no such session" }); return; }
  const { text } = body;
  const session = getSession(req.params.id);
  const outcome = session?.model === "gpt-5.6-sol"
    ? sendCodexFollowUp(req.params.id, text)
    : sendFollowUp(req.params.id, text);
  if (outcome.ok) {
    res.status(202).json({ ok: true, resumed: outcome.resumed });
    return;
  }

  if (outcome.reason === "unknown_session") {
    res.status(404).json({ error: "no such session" });
  } else if (outcome.reason === "not_resumable") {
    res.status(409).json({
      error:
        "This session never got far enough to be resumed. Launch a new one instead.",
    });
  } else if (outcome.reason === "busy") {
    res.status(409).json({ error: "GPT-5.6 Sol is still answering the previous message." });
  } else {
    res.status(429).json({
      error: `Too many sessions running at once (${activeSessionCount()}/${getSettings().maxConcurrentSessions}). Wait for one to finish, then try again.`,
    });
  }
});

app.post("/sessions/:id/permission-response", (req: Request, res: Response) => {
  const body = validatedBody(permissionResponseSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getSession(req.params.id)?.agentId !== agentId) { res.status(404).json({ error: "no such session" }); return; }
  const ok = resolvePermission(
    req.params.id,
    body.requestId,
    body.decision,
    body.updatedInput as Record<string, unknown> | undefined
  );
  if (!ok) {
    res.status(404).json({ error: "no pending permission request with that id" });
    return;
  }
  res.status(202).json({ ok: true });
});

app.post("/sessions/:id/interrupt", async (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getSession(req.params.id)?.agentId !== agentId) { res.status(404).json({ error: "no such session" }); return; }
  try {
    const session = getSession(req.params.id);
    const ok = session?.model === "gpt-5.6-sol"
      ? interruptCodexSession(req.params.id)
      : await interruptSession(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "session not active" });
      return;
    }
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not interrupt the session.",
    });
  }
});

// ---- Tasks ----

app.get("/tasks", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res);
  if (agentId === null) return;
  res.json(listTasks(agentId));
});

app.post("/tasks", (req: Request, res: Response) => {
  const body = validatedBody(createTaskSchema, req, res);
  if (!body) return;
  const { title, description, missionId } = body;
  const agentId = owningAgentId(req, res);
  if (agentId === null) return;
  if (missionId && getMission(missionId)?.agentId !== agentId) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  const task = createTask({ title, description, missionId, agentId });
  globalBus.emit("missions_changed");
  res.status(201).json(task);
});

app.patch("/tasks/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateTaskSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getTask(req.params.id)?.agentId !== agentId) { res.status(404).json({ error: "not found" }); return; }
  if (body.missionId && (agentId ? getMission(body.missionId)?.agentId !== agentId : !getMission(body.missionId))) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  const task = updateTask(req.params.id, body);
  if (!task) {
    res.status(404).json({ error: "not found" });
    return;
  }
  globalBus.emit("missions_changed");
  res.json(task);
});

app.delete("/tasks/:id", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getTask(req.params.id)?.agentId !== agentId) { res.status(404).json({ error: "not found" }); return; }
  deleteTask(req.params.id);
  globalBus.emit("missions_changed");
  res.status(204).send();
});

// ---- Missions and deliverables ----

app.get("/missions", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res);
  if (agentId === null) return;
  res.json(listMissions(agentId));
});

app.post("/missions", (req: Request, res: Response) => {
  const body = validatedBody(createMissionSchema, req, res);
  if (!body) return;
  const agentId = owningAgentId(req, res);
  if (agentId === null) return;
  const mission = createMission({ ...body, agentId });
  globalBus.emit("missions_changed");
  res.status(201).json(mission);
});

app.get("/missions/:id", (req: Request, res: Response) => {
  const mission = getMission(req.params.id);
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!mission || (agentId && mission.agentId !== agentId)) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  res.json({
    mission,
    tasks: listTasks(agentId).filter((task) => task.missionId === mission.id),
    deliverables: listDeliverables(mission.id, agentId),
    updates: listMissionUpdates(mission.id, agentId),
  });
});

app.patch("/missions/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateMissionSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getMission(req.params.id)?.agentId !== agentId) { res.status(404).json({ error: "Mission not found" }); return; }
  const mission = updateMission(req.params.id, body);
  if (!mission) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  globalBus.emit("missions_changed");
  res.json(mission);
});

app.post("/missions/:id/advance", (req: Request, res: Response) => {
  const mission = getMission(req.params.id);
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!mission || (agentId && mission.agentId !== agentId)) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  const cwd = getSettings().chatWorkingDirectory.trim() || process.cwd();
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    res.status(400).json({ error: `Working directory does not exist: ${cwd}. Set it in Settings.` });
    return;
  }
  if (atConcurrencyLimit()) {
    res.status(429).json({
      error: `Too many sessions running at once (${activeSessionCount()}/${getSettings().maxConcurrentSessions}).`,
    });
    return;
  }
  const task = createTask({
    title: `Advance: ${mission.title}`,
    description: `Work toward this outcome: ${mission.outcome}`,
    missionId: mission.id,
    agentId: mission.agentId,
  });
  const prompt = `Advance the mission "${mission.title}".\n\nDesired outcome: ${mission.outcome}\n\nCurrent next action: ${mission.nextAction || "Determine the best next action."}\n\nMake concrete progress, explain what changed, and identify any deliverable or decision that needs my review.`;
  const session = createSession({
    title: mission.title,
    cwd,
    permissionMode: "default",
    taskId: task.id,
    agentId: mission.agentId,
  });
  linkTaskToSession(task.id, session.id);
  updateMission(mission.id, { status: "active" });
  globalBus.emit("session_updated", session.id);
  globalBus.emit("missions_changed");
  void startSession({
    id: session.id,
    prompt,
    cwd,
    permissionMode: "default",
    title: session.title,
  });
  res.status(201).json({ mission: getMission(mission.id), task, session });
});

app.delete("/missions/:id", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getMission(req.params.id) || (agentId && getMission(req.params.id)?.agentId !== agentId)) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  deleteMission(req.params.id);
  globalBus.emit("missions_changed");
  res.status(204).send();
});

app.get("/deliverables", (req: Request, res: Response) => {
  const missionId = typeof req.query.missionId === "string" ? req.query.missionId : undefined;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json(listDeliverables(missionId, agentId));
});

app.post("/missions/:id/deliverables", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getMission(req.params.id)?.agentId !== agentId) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  const body = validatedBody(createDeliverableSchema, req, res);
  if (!body) return;
  const deliverable = createDeliverable({ missionId: req.params.id, ...body });
  globalBus.emit("missions_changed");
  res.status(201).json(deliverable);
});

app.patch("/deliverables/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateDeliverableSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && !listDeliverables(undefined, agentId).some((item) => item.id === req.params.id)) { res.status(404).json({ error: "Deliverable not found" }); return; }
  const deliverable = updateDeliverable(req.params.id, body);
  if (!deliverable) {
    res.status(404).json({ error: "Deliverable not found" });
    return;
  }
  globalBus.emit("missions_changed");
  res.json(deliverable);
});

app.delete("/deliverables/:id", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && !listDeliverables(undefined, agentId).some((item) => item.id === req.params.id)) { res.status(404).json({ error: "Deliverable not found" }); return; }
  deleteDeliverable(req.params.id);
  globalBus.emit("missions_changed");
  res.status(204).send();
});

app.get("/mission-updates", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json(listMissionUpdates(undefined, agentId));
});

app.post("/mission-updates/:id/review", (req: Request, res: Response) => {
  const body = validatedBody(reviewMissionUpdateSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const update = getMissionUpdate(req.params.id);
  if (!update || (agentId && getMission(update.missionId)?.agentId !== agentId)) {
    res.status(404).json({ error: "Mission update not found" });
    return;
  }
  if (update.status !== "proposed") {
    res.status(409).json({ error: "This mission update has already been reviewed" });
    return;
  }
  if (body.decision === "apply") {
    updateMission(update.missionId, {
      ...(update.proposedNextAction ? { nextAction: update.proposedNextAction } : {}),
      status: update.blocker ? "blocked" : "active",
    });
  }
  const reviewed = reviewMissionUpdate(update.id, body.decision === "apply" ? "applied" : "dismissed");
  globalBus.emit("missions_changed");
  res.json({ update: reviewed, mission: getMission(update.missionId) });
});

// ---- Campaigns and Content Studio ----

app.get("/workflows", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json({
    workflows: listWorkflows(agentId),
    content: listContentItems(undefined, agentId),
    generationRuns: listWorkflowGenerationRuns(undefined, agentId),
    publicationRuns: listContentPublicationRuns(undefined, agentId),
    accounts: listWorkflowAccounts(agentId),
    characters: listCharacters(agentId),
    adCampaignCounts: adCampaignCountsByWorkflow(agentId),
    metricCounts: metricCountsByWorkflow(agentId),
    insightCounts: insightCountsByWorkflow(agentId),
  });
});

/** The voice a workflow writes in. One character per workflow. */
app.put("/workflows/:id/character", (req: Request, res: Response) => {
  const body = validatedBody(saveWorkflowCharacterSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const workflow = getWorkflow(req.params.id, agentId);
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }
  const character = saveCharacter({ workflowId: workflow.id, ...body });
  globalBus.emit("workflows_changed");
  res.json(character);
});

app.get("/workflows/:id/character", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const workflow = getWorkflow(req.params.id, agentId);
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json({ character: getCharacter(workflow.id) ?? null });
});

/**
 * Stage 1: which accounts a workflow may act as.
 *
 * Attaching is what makes publishing possible — `accountForContent` refuses to
 * publish a workflow with no attached account for the channel, so this is the
 * gate rather than a label.
 */
app.post("/workflows/:id/accounts", (req: Request, res: Response) => {
  const body = validatedBody(attachWorkflowAccountSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const workflow = getWorkflow(req.params.id, agentId);
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }

  const connection = getConnectionById(body.connectionId);
  if (!connection) { res.status(404).json({ error: "Account not found" }); return; }
  // An account owned by another agent must never become reachable by this
  // workflow — that is exactly the cross-business leak this design prevents.
  if (connection.agentId && workflow.agentId && connection.agentId !== workflow.agentId) {
    res.status(403).json({ error: "That account belongs to another agent." });
    return;
  }

  attachWorkflowAccount(workflow.id, connection.id);
  globalBus.emit("workflows_changed");
  res.status(201).json({ workflowId: workflow.id, connectionId: connection.id });
});

app.delete("/workflows/:id/accounts/:connectionId", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const workflow = getWorkflow(req.params.id, agentId);
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }
  detachWorkflowAccount(workflow.id, req.params.connectionId);
  globalBus.emit("workflows_changed");
  res.status(204).send();
});

app.post("/workflows", (req: Request, res: Response) => {
  const body = validatedBody(createWorkflowSchema, req, res);
  if (!body) return;
  const agentId = owningAgentId(req, res); if (agentId === null) return;
  if (body.missionId && getMission(body.missionId)?.agentId !== agentId) {
    res.status(400).json({ error: "Mission not found" });
    return;
  }
  const campaign = createWorkflow({
    ...body,
    approvalPolicy: body.approvalPolicy ?? "each_item",
    agentId,
  });
  globalBus.emit("workflows_changed");
  res.status(201).json(campaign);
});

app.get("/workflows/:id", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const campaign = getWorkflow(req.params.id, agentId);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({
    campaign,
    content: listContentItems(campaign.id, agentId),
    generationRuns: listWorkflowGenerationRuns(campaign.id, agentId),
    publicationRuns: listContentPublicationRuns(campaign.id, agentId),
  });
});

app.patch("/workflows/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateWorkflowSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getWorkflow(req.params.id, agentId)) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (body.missionId && getMission(body.missionId)?.agentId !== agentId) {
    res.status(400).json({ error: "Mission not found" });
    return;
  }
  const campaign = updateWorkflow(req.params.id, body);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  globalBus.emit("workflows_changed");
  res.json(campaign);
});

app.delete("/workflows/:id", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getWorkflow(req.params.id, agentId)) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  deleteWorkflow(req.params.id);
  globalBus.emit("workflows_changed");
  res.status(204).send();
});

app.post("/workflows/:id/content", (req: Request, res: Response) => {
  const body = validatedBody(createContentItemSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const campaign = getWorkflow(req.params.id, agentId);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!campaign.channels.includes(body.channel)) {
    res.status(400).json({ error: `${body.channel} is not an approved channel for this campaign` });
    return;
  }
  const item = createContentItem({ workflowId: campaign.id, ...body });
  globalBus.emit("workflows_changed");
  res.status(201).json(item);
});

app.patch("/content/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateContentItemSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const current = getContentItem(req.params.id, agentId);
  if (!current) {
    res.status(404).json({ error: "Content item not found" });
    return;
  }
  const campaign = getWorkflow(current.workflowId);
  if (!campaign) {
    res.status(409).json({ error: "The content item no longer has a campaign" });
    return;
  }
  if (body.channel && !campaign.channels.includes(body.channel)) {
    res.status(400).json({ error: `${body.channel} is not an approved channel for this campaign` });
    return;
  }
  if (body.status === "scheduled" && !(body.scheduledFor ?? current.scheduledFor)) {
    res.status(400).json({ error: "Choose a publishing time before scheduling content" });
    return;
  }
  const nextChannel = body.channel ?? current.channel;
  const nextBody = body.body ?? current.body;
  if (body.status === "published" && nextChannel === "x") {
    res.status(400).json({ error: "Use Publish with Jarvis so X publication is approval-gated and confirmed" });
    return;
  }
  if (body.status === "measured" && !["published", "measured"].includes(current.status)) {
    res.status(400).json({ error: "Content must be published before performance can be measured" });
    return;
  }
  if (body.status === "scheduled" && nextChannel === "x" && nextBody.length > 280) {
    res.status(400).json({ error: `X posts must be 280 characters or fewer; this draft has ${nextBody.length}` });
    return;
  }
  const item = updateContentItem(req.params.id, {
    ...body,
    ...(body.scheduledFor ? { scheduledFor: new Date(body.scheduledFor).toISOString() } : {}),
  });
  globalBus.emit("workflows_changed");
  res.json(item);
});

app.delete("/content/:id", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getContentItem(req.params.id, agentId)) {
    res.status(404).json({ error: "Content item not found" });
    return;
  }
  deleteContentItem(req.params.id);
  globalBus.emit("workflows_changed");
  res.status(204).send();
});

app.post("/content/:id/publish", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const item = getContentItem(req.params.id, agentId);
  if (!item) {
    res.status(404).json({ error: "Content item not found" });
    return;
  }
  try {
    const result = startContentPublication(item);
    res.status(201).json(result);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/workflows/:id/generate", (req: Request, res: Response) => {
  const body = validatedBody(generateWorkflowContentSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const campaign = getWorkflow(req.params.id, agentId);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const channels = body.channels ?? campaign.channels;
  const unapproved = channels.find((channel) => !campaign.channels.includes(channel));
  if (unapproved) {
    res.status(400).json({ error: `${unapproved} is not an approved channel for this campaign` });
    return;
  }
  if (atConcurrencyLimit()) {
    res.status(429).json({
      error: `Too many sessions running at once (${activeSessionCount()}/${getSettings().maxConcurrentSessions}). Wait for one to finish.`,
    });
    return;
  }

  const session = createSession({
    title: `Create content: ${campaign.name}`,
    cwd: process.cwd(),
    permissionMode: "default",
    allowedTools: [],
    agentId,
  });
  const generationRun = createWorkflowGenerationRun({
    workflowId: campaign.id,
    sessionId: session.id,
    requestedCount: body.count,
    // Captured now rather than at reconcile time: editing the sheet while a
    // run is in flight must not relabel text the previous version wrote.
    characterVersion: getCharacter(campaign.id)?.version ?? null,
  });
  if (campaign.status === "draft") updateWorkflow(campaign.id, { status: "active" });
  globalBus.emit("session_updated", session.id);
  globalBus.emit("workflows_changed");

  void startSession({
    id: session.id,
    prompt: workflowGenerationPrompt({
      campaign,
      ...body,
      channels,
      characterBrief: characterBrief(getCharacter(campaign.id)),
    }),
    cwd: session.cwd,
    permissionMode: "default",
    allowedTools: [],
    title: session.title,
    isolated: true,
    // Generation previously passed no model and so ran on the CLI default,
    // while the model that actually wins voice fidelity sat unused. Congruity
    // is the whole point of a character, so this is the one place worth
    // spending the better model by default. See CHARACTER_PLAN.md.
    claudeModel: body.claudeModel ?? "opus",
  });

  res.status(201).json({ campaign: getWorkflow(campaign.id), session, generationRun });
});

// ---- Scheduled tasks ----

app.get("/scheduled-tasks", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res);
  if (agentId === null) return;
  res.json(listScheduledTasks(agentId));
});

app.post("/scheduled-tasks", (req: Request, res: Response) => {
  const body = validatedBody(createScheduledTaskSchema, req, res);
  if (!body) return;
  // Checked at save time, not at 6am. A mistyped path here is otherwise invisible
  // until the run fails unattended, and the whole day's work is lost with it.
  if (!existsSync(body.cwd) || !statSync(body.cwd).isDirectory()) {
    res.status(400).json({ error: `Working directory does not exist: ${body.cwd}` });
    return;
  }
  const agentId = owningAgentId(req, res);
  if (agentId === null) return;
  const next = computeNextRun(body.timeOfDay, body.daysOfWeek, new Date());
  const task = createScheduledTask({
    prompt: body.prompt,
    cwd: body.cwd,
    permissionMode: body.permissionMode ?? "default",
    allowedTools: body.allowedTools,
    timeOfDay: body.timeOfDay,
    daysOfWeek: body.daysOfWeek,
    nextRunAt: next ? next.toISOString() : new Date().toISOString(),
    agentId,
  });
  globalBus.emit("automations_changed");
  res.status(201).json(task);
});

app.patch("/scheduled-tasks/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateScheduledTaskSchema, req, res);
  if (!body) return;
  const existing = getScheduledTask(req.params.id);
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!existing || (agentId && existing.agentId !== agentId)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (body.cwd !== undefined && (!existsSync(body.cwd) || !statSync(body.cwd).isDirectory())) {
    res.status(400).json({ error: `Working directory does not exist: ${body.cwd}` });
    return;
  }
  // Reschedule whenever the timing itself, or the enabled flag, changes.
  let nextRunAt: string | null | undefined = undefined;
  if (body.timeOfDay !== undefined || body.daysOfWeek !== undefined || body.enabled !== undefined) {
    const enabled = body.enabled ?? existing.enabled;
    const timeOfDay = body.timeOfDay ?? existing.timeOfDay;
    const daysOfWeek = body.daysOfWeek ?? existing.daysOfWeek;
    const next = enabled ? computeNextRun(timeOfDay, daysOfWeek, new Date()) : null;
    nextRunAt = next ? next.toISOString() : null;
  }
  const task = updateScheduledTask(req.params.id, { ...body, nextRunAt });
  globalBus.emit("automations_changed");
  res.json(task);
});

app.get("/scheduled-tasks/:id/rehearsal", (req: Request, res: Response) => {
  const task = getScheduledTask(req.params.id);
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!task || (agentId && task.agentId !== agentId)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const nextRuns: string[] = [];
  let cursor = new Date();
  for (let i = 0; i < 3; i += 1) {
    const next = computeNextRun(task.timeOfDay, task.daysOfWeek, cursor);
    if (!next) break;
    nextRuns.push(next.toISOString());
    cursor = new Date(next.getTime() + 60_000);
  }
  res.json({
    taskId: task.id,
    nextRuns,
    checks: [
      { label: "Working directory", ok: existsSync(task.cwd), detail: task.cwd },
      { label: "Schedule", ok: task.daysOfWeek.length > 0, detail: `${task.timeOfDay}, ${task.daysOfWeek.length} day${task.daysOfWeek.length === 1 ? "" : "s"} each week` },
      { label: "Master switch", ok: getSettings().automationsEnabled, detail: getSettings().automationsEnabled ? "Automations are enabled" : "All automations are paused in Settings" },
      { label: "This automation", ok: task.enabled, detail: task.enabled ? "Enabled" : "Paused" },
    ],
    approvalRequired: /\b(post|send|publish|email|message)\b/i.test(task.prompt),
  });
});

app.delete("/scheduled-tasks/:id", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (agentId && getScheduledTask(req.params.id)?.agentId !== agentId) { res.status(404).json({ error: "not found" }); return; }
  deleteScheduledTask(req.params.id);
  globalBus.emit("automations_changed");
  res.status(204).send();
});

// ---- Jarvis evolution and Lab ----

app.get("/evolution", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  ensureEvolutionBootstrap();
  res.json({
    proposals: listEvolutionProposals(agentId),
    policies: listEvolutionPolicies(),
    readiness: evolutionReadiness(),
  });
});

app.post("/evolution/proposals", (req: Request, res: Response) => {
  const body = validatedBody(createEvolutionProposalSchema, req, res);
  if (!body) return;
  const agentId = owningAgentId(req, res); if (agentId === null) return;
  const proposal = createEvolutionProposal({ ...body, agentId });
  globalBus.emit("evolution_changed");
  res.status(201).json(proposal);
});

app.patch("/evolution/proposals/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateEvolutionProposalSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  if (!getEvolutionProposal(req.params.id, agentId)) { res.status(404).json({ error: "Evolution proposal not found" }); return; }
  const proposal = updateEvolutionProposal(req.params.id, body);
  if (!proposal) {
    res.status(404).json({ error: "Evolution proposal not found" });
    return;
  }
  globalBus.emit("evolution_changed");
  res.json(proposal);
});

app.patch("/evolution/policies/:changeClass", (req: Request, res: Response) => {
  const changeClass = req.params.changeClass;
  if (!["knowledge", "behavior", "capability", "product", "security"].includes(changeClass)) {
    res.status(404).json({ error: "Unknown change class" });
    return;
  }
  const body = validatedBody(updateEvolutionPolicySchema, req, res);
  if (!body) return;
  if (changeClass === "security" && body.autonomy !== "approval_required") {
    res.status(400).json({ error: "Security changes always require explicit approval" });
    return;
  }
  if (changeClass === "product" && body.autonomy === "automatic") {
    res.status(400).json({ error: "Product changes cannot promote automatically until atomic rollback is available" });
    return;
  }
  const policy = updateEvolutionPolicy(
    changeClass as "knowledge" | "behavior" | "capability" | "product" | "security",
    body.autonomy
  );
  globalBus.emit("evolution_changed");
  res.json(policy);
});

app.post("/evolution/proposals/:id/start-build", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const proposal = getEvolutionProposal(req.params.id, agentId);
  if (!proposal) {
    res.status(404).json({ error: "Evolution proposal not found" });
    return;
  }
  if (proposal.stage === "building") {
    res.status(409).json({ error: "This proposal is already building in Lab" });
    return;
  }
  if (!existsSync(LAB_PATH) || !statSync(LAB_PATH).isDirectory()) {
    res.status(503).json({ error: `Jarvis Lab is not available at ${LAB_PATH}` });
    return;
  }
  if (atConcurrencyLimit()) {
    res.status(429).json({ error: "Jarvis is at its active-session limit" });
    return;
  }
  const prompt = labBuildPrompt(proposal);
  const session = createSession({
    title: `[Lab] ${proposal.title}`,
    cwd: LAB_PATH,
    permissionMode: "default",
    agentId,
  });
  updateEvolutionProposal(proposal.id, { stage: "building", labSessionId: session.id });
  globalBus.emit("session_updated", session.id);
  globalBus.emit("evolution_changed");
  void startSession({
    id: session.id,
    prompt,
    cwd: LAB_PATH,
    permissionMode: "default",
    title: session.title,
    onTurnFinished: (ok) => {
      updateEvolutionProposal(proposal.id, { stage: ok ? "review" : "observed" });
      globalBus.emit("evolution_changed");
    },
  });
  res.status(201).json({ proposal: getEvolutionProposal(proposal.id), session });
});

// The merge/build/restart/verify/rollback sequence outlives this process —
// restart-service.ps1 kills and replaces it partway through — so it has to
// run as a genuinely independent process, not a child of it. See
// scripts/promote-lab.ps1 and scripts/promote-lab-launcher.ps1 (the launcher
// exists because a direct spawn of promote-lab.ps1 was tried first and
// failed two different ways — see that script's own comment for what was
// actually observed on this machine before landing on Start-Process).
const PROMOTE_LAUNCHER_PATH = resolve(process.cwd(), "..", "..", "scripts", "promote-lab-launcher.ps1");

app.post("/evolution/proposals/:id/promote", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const proposal = getEvolutionProposal(req.params.id, agentId);
  if (!proposal) {
    res.status(404).json({ error: "Evolution proposal not found" });
    return;
  }
  if (proposal.stage !== "review") {
    res.status(409).json({
      error: `This proposal is ${proposal.stage.replace("_", " ")}, not ready for promotion. Only a reviewed build can be promoted.`,
    });
    return;
  }
  if (!evolutionReadiness().promotionEngineReady) {
    res.status(503).json({ error: "The promotion engine isn't available on this machine." });
    return;
  }
  if (!existsSync(PROMOTE_LAUNCHER_PATH)) {
    res.status(503).json({ error: `Promotion launcher not found at ${PROMOTE_LAUNCHER_PATH}` });
    return;
  }

  updateEvolutionProposal(proposal.id, { stage: "promoting" });
  globalBus.emit("evolution_changed");

  // The launcher's own job is just Start-Process and exit — it does not
  // matter that it is still part of this process's tree, because by the
  // time anything stops "Jarvis Orchestrator" the real script is already
  // running independently (Start-Process, not a raw child, is what actually
  // escapes the scheduled task's process tree here). This spawn call itself
  // only needs to survive long enough to launch the launcher, so plain
  // "ignore" stdio is fine — the real script's output goes to
  // scripts/logs/promote-lab-spawn.log via -RedirectStandardOutput inside
  // the launcher, not through this process at all.
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PROMOTE_LAUNCHER_PATH, "-ProposalId", proposal.id],
    { stdio: "ignore", windowsHide: true }
  );
  child.on("error", (err) => {
    console.error("[evolution] could not start the promotion launcher:", err.message);
    updateEvolutionProposal(proposal.id, { stage: "rolled_back", evidence: `Could not start the promotion launcher: ${err.message}` });
    globalBus.emit("evolution_changed");
  });
  child.unref();

  res.status(202).json({ ok: true, proposal: getEvolutionProposal(proposal.id) });
});

// ---- Insights ----

app.get("/insights/trends", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json(trendsOverview(agentId));
});

// ---- Paid Growth Control ----

app.get("/paid-growth", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json(paidGrowthOverview(agentId));
});

app.post("/paid-growth/workflows", (req: Request, res: Response) => {
  const body = validatedBody(createPaidGrowthCampaignSchema, req, res);
  if (!body) return;
  const agentId = owningAgentId(req, res); if (agentId === null) return;
  if (body.workflowId && !getWorkflow(body.workflowId, agentId)) {
    res.status(400).json({ error: "Linked campaign not found" });
    return;
  }
  const campaign = createPaidGrowthCampaign({ ...body, agentId });
  globalBus.emit("paid_growth_changed");
  res.status(201).json(campaign);
});

app.patch("/paid-growth/workflows/:id", (req: Request, res: Response) => {
  const body = validatedBody(updatePaidGrowthCampaignSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const current = getPaidGrowthCampaign(req.params.id, agentId);
  if (!current) {
    res.status(404).json({ error: "Paid campaign not found" });
    return;
  }
  if (body.externalCampaignId && current.platform !== "x_ads" && !/^\d+$/.test(body.externalCampaignId)) {
    res.status(400).json({ error: "Google Ads and Meta Ads campaign IDs must contain digits only" });
    return;
  }
  if (body.externalBudgetEntityId && current.platform !== "x_ads" && !/^\d+$/.test(body.externalBudgetEntityId)) {
    res.status(400).json({ error: "Google Ads and Meta Ads budget entity IDs must contain digits only" });
    return;
  }
  const daily = body.dailyBudgetMinor ?? current.dailyBudgetMinor;
  const lifetime = body.lifetimeBudgetMinor ?? current.lifetimeBudgetMinor;
  if (lifetime < daily || lifetime < current.spentMinor) {
    res.status(400).json({ error: "Lifetime budget must cover the daily budget and spend already recorded" });
    return;
  }
  if (current.status !== "draft" && (body.dailyBudgetMinor || body.lifetimeBudgetMinor)) {
    res.status(409).json({ error: "Use a reviewable budget decision after a campaign leaves draft" });
    return;
  }
  const campaign = updatePaidGrowthCampaign(current.id, body);
  globalBus.emit("paid_growth_changed");
  res.json(campaign);
});

app.post("/paid-growth/workflows/:id/performance", (req: Request, res: Response) => {
  const body = validatedBody(updatePaidGrowthPerformanceSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const current = getPaidGrowthCampaign(req.params.id, agentId);
  if (!current) {
    res.status(404).json({ error: "Paid campaign not found" });
    return;
  }
  if (body.spentMinor < current.spentMinor) {
    res.status(400).json({ error: "Cumulative spend cannot move backward" });
    return;
  }
  const campaign = recordManualPerformance(current.id, body);
  globalBus.emit("paid_growth_changed");
  res.json(campaign);
});

app.post("/paid-growth/workflows/:id/sync", async (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  try {
    const result = await syncPaidGrowthCampaign(req.params.id, agentId);
    for (const decision of result.decisions) {
      notify({
        type: "paid_growth_approval",
        severity: decision.kind === "pause" ? "warning" : "info",
        title: "Paid growth decision ready",
        body: `${result.campaign.name}: ${decision.reason}`,
        agentId: result.campaign.agentId,
      });
    }
    globalBus.emit("paid_growth_changed");
    res.json({ ...result, overview: paidGrowthOverview(agentId) });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/paid-growth/workflows/:id/request-launch", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  try {
    const decision = requestPaidGrowthLaunch(req.params.id, agentId);
    const campaign = getPaidGrowthCampaign(req.params.id, agentId)!;
    notify({
      type: "paid_growth_approval",
      severity: "warning",
      title: "Paid campaign needs approval",
      body: `${campaign.name} is ready for a ${campaign.dailyBudgetMinor} ${campaign.currency} minor-unit daily envelope.`,
      agentId: campaign.agentId,
    });
    globalBus.emit("paid_growth_changed");
    res.status(201).json(decision);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/paid-growth/recommendations/refresh", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const decisions = refreshPaidGrowthRecommendations(agentId);
  for (const decision of decisions) {
    const campaign = getPaidGrowthCampaign(decision.paidCampaignId);
    notify({
      type: "paid_growth_approval",
      severity: decision.kind === "pause" ? "warning" : "info",
      title: "Paid growth decision ready",
      body: `${campaign?.name ?? "A paid campaign"}: ${decision.reason}`,
      agentId: campaign?.agentId,
    });
  }
  globalBus.emit("paid_growth_changed");
  res.json({ created: decisions, overview: paidGrowthOverview(agentId) });
});

app.post("/paid-growth/decisions/:id/review", async (req: Request, res: Response) => {
  const body = validatedBody(reviewPaidGrowthDecisionSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const owned = listPaidGrowthDecisions(agentId).some((item) => item.id === req.params.id);
  if (!owned) { res.status(404).json({ error: "Paid growth decision not found" }); return; }
  try {
    const decision = await decidePaidGrowthRecommendation(req.params.id, body.decision);
    globalBus.emit("paid_growth_changed");
    res.json({ decision, overview: paidGrowthOverview(agentId) });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/paid-growth/workflows/:id/history", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  const campaign = getPaidGrowthCampaign(req.params.id, agentId);
  if (!campaign) { res.status(404).json({ error: "Paid campaign not found" }); return; }
  res.json(listMeasurementFacts(campaign.id));
});

// ---- Campaign experiments (GAPS.md attribution gap, paid-only slice) ----

app.get("/paid-growth/experiments", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json(campaignExperimentsOverview(agentId));
});

app.post("/paid-growth/experiments", (req: Request, res: Response) => {
  const body = validatedBody(createCampaignExperimentSchema, req, res);
  if (!body) return;
  const agentId = owningAgentId(req, res); if (agentId === null) return;
  try {
    const experiment = createExperiment(body, agentId);
    globalBus.emit("paid_growth_changed");
    res.status(201).json(experiment);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/paid-growth/experiments/:id/conclude", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  try {
    const { experiment, decision } = concludeExperiment(req.params.id, agentId);
    if (decision) {
      notify({
        type: "paid_growth_approval",
        severity: "info",
        title: "Experiment concluded with a decision ready",
        body: `${experiment.name}: ${decision.reason}`,
        agentId,
      });
    } else {
      notify({
        type: "campaign_experiment_concluded",
        severity: "info",
        title: "Experiment concluded, inconclusive",
        body: `${experiment.name}: ${experiment.conclusionNote ?? "No winner was declared."}`,
        agentId,
      });
    }
    globalBus.emit("paid_growth_changed");
    res.json({ experiment, decision, overview: campaignExperimentsOverview(agentId) });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/paid-growth/experiments/:id/abandon", (req: Request, res: Response) => {
  const body = validatedBody(abandonCampaignExperimentSchema, req, res);
  if (!body) return;
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  try {
    const experiment = abandonExperiment(req.params.id, body.reason, agentId);
    globalBus.emit("paid_growth_changed");
    res.json({ experiment, overview: campaignExperimentsOverview(agentId) });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ---- Platform connections ----

app.get("/platforms", (_req: Request, res: Response) => {
  res.json(platformDefinitions());
});

app.get("/connections", (_req: Request, res: Response) => {
  res.json(listConnections());
});

app.put("/connections/:platformId", (req: Request, res: Response) => {
  const platform = getPlatform(req.params.platformId);
  if (!platform) {
    res.status(404).json({ error: "unknown platform" });
    return;
  }
  const body = validatedBody(saveConnectionSchema, req, res);
  if (!body) return;
  const submitted = body.values;

  if (body.connectionId && !getConnectionById(body.connectionId)) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  // Blank fields mean "leave as-is" so re-editing doesn't wipe secrets the user
  // no longer has a copy of (most platforms show them exactly once).
  //
  // A brand-new account merges nothing: inheriting the first account's
  // credentials would silently create a duplicate of it under a new name,
  // which is the opposite of adding a second business.
  const existingCredentials = body.createNew
    ? {}
    : body.connectionId
      ? (getConnectionCredentialsById(body.connectionId) ?? {})
      : (getConnectionCredentials(platform.definition.id) ?? {});
  const merged: Record<string, string> = { ...existingCredentials };
  for (const [key, value] of Object.entries(submitted)) {
    // Store the trimmed value, not the raw one. Credentials are pasted, and a
    // trailing newline or space from the clipboard is invisible in a password
    // field but makes the key fail with a confusing "invalid key" from the API.
    const trimmed = String(value ?? "").trim();
    if (trimmed) merged[key] = trimmed;
  }

  const missing = platform.definition.fields
    .filter((f) => !f.optional && !String(merged[f.key] ?? "").trim())
    .map((f) => f.label);
  if (missing.length) {
    res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
    return;
  }

  // Catch a mispaste here rather than letting it surface later as an opaque
  // "invalid key" from the platform, which gives the user nothing to act on.
  for (const field of platform.definition.fields) {
    const value = merged[field.key];
    if (!field.expectedPrefix || !value) continue;
    if (!value.startsWith(field.expectedPrefix)) {
      res.status(400).json({
        error: `${field.label} should start with "${field.expectedPrefix}". The value given starts with "${value.slice(0, 4)}…", so it looks like a different value was pasted.`,
      });
      return;
    }
  }
  const agentId = owningAgentId(req, res);
  if (agentId === null) return;
  const connection = saveConnection(platform.definition.id, merged, {
    id: body.connectionId,
    label: body.label,
    forceNew: body.createNew,
    // A second account belongs to the agent that created it. The first stays
    // shared, so existing installs keep reaching every platform they did.
    agentId: body.createNew ? agentId : undefined,
  });
  if (platform.definition.id === "slack") refreshSlackAgentBridge();
  // Saving real credentials means any guided signup for this platform is
  // over — nothing left for the wizard to track.
  if (getSignupProgress(platform.definition.id)) {
    clearSignupProgress(platform.definition.id);
    globalBus.emit("platform_signup_changed");
  }
  res.json(connection);
});

app.get("/platforms/:platformId/signup", (req: Request, res: Response) => {
  const platform = getPlatform(req.params.platformId);
  if (!platform) { res.status(404).json({ error: "unknown platform" }); return; }
  res.json({
    progress: getSignupProgress(platform.definition.id) ?? null,
    events: listSignupEmailEvents(platform.definition.id),
  });
});

app.post("/platforms/:platformId/signup", (req: Request, res: Response) => {
  const platform = getPlatform(req.params.platformId);
  if (!platform) { res.status(404).json({ error: "unknown platform" }); return; }
  const body = validatedBody(startPlatformSignupSchema, req, res);
  if (!body) return;
  const progress = startPlatformSignup(platform.definition.id, body);
  globalBus.emit("platform_signup_changed");
  res.status(201).json(progress);
});

app.post("/platforms/:platformId/signup/step", (req: Request, res: Response) => {
  const platform = getPlatform(req.params.platformId);
  if (!platform) { res.status(404).json({ error: "unknown platform" }); return; }
  const step = Number((req.body as { step?: unknown })?.step);
  if (!Number.isInteger(step) || step < 0) {
    res.status(400).json({ error: "step must be a non-negative integer" });
    return;
  }
  const progress = advanceSignupStep(platform.definition.id, step);
  if (!progress) { res.status(404).json({ error: "no signup in progress for this platform" }); return; }
  globalBus.emit("platform_signup_changed");
  res.json(progress);
});

app.delete("/platforms/:platformId/signup", (req: Request, res: Response) => {
  const platform = getPlatform(req.params.platformId);
  if (!platform) { res.status(404).json({ error: "unknown platform" }); return; }
  clearSignupProgress(platform.definition.id);
  globalBus.emit("platform_signup_changed");
  res.status(204).send();
});

app.post("/connections/:platformId/test", async (req: Request, res: Response) => {
  const platform = getPlatform(req.params.platformId);
  if (!platform) {
    res.status(404).json({ error: "unknown platform" });
    return;
  }
  const creds = getConnectionCredentials(platform.definition.id);
  if (!creds) {
    res.status(400).json({ error: "no credentials saved for this platform yet" });
    return;
  }
  let result;
  try {
    result = await platform.test(creds);
  } catch (err) {
    // Network failures and timeouts are connection problems, not crashes.
    result = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  // Resolved rather than assumed: the platform id stopped being the connection
  // id when a platform gained the ability to hold several accounts.
  const testedId = resolveConnectionId(platform.definition.id);
  if (!testedId) {
    res.status(409).json({
      error: `Several ${platform.definition.name} accounts exist, so this platform-wide test is ambiguous. Test a specific account instead.`,
    });
    return;
  }
  const connection = recordTestResult(
    testedId,
    result.ok,
    result.detail ?? null,
    result.ok ? null : (result.message ?? "Connection test failed")
  );
  if (platform.definition.id === "slack") refreshSlackAgentBridge();
  res.json({ result, connection });
});

/**
 * Edit one account's daily action cap. Null clears the override so the global
 * default applies again — clearing is not the same as removing the limit.
 */
/**
 * Test or remove one specific account.
 *
 * Keyed by connection id rather than platform, because the platform-keyed
 * routes refuse once several accounts exist — there is no single answer to
 * "test X" when there are two X accounts, and guessing would test the wrong
 * business's credentials.
 */
app.post("/accounts/:connectionId/test", async (req: Request, res: Response) => {
  const connection = getConnectionById(req.params.connectionId);
  if (!connection) { res.status(404).json({ error: "Account not found" }); return; }
  const platform = getPlatform(connection.platformId);
  if (!platform) { res.status(404).json({ error: "unknown platform" }); return; }

  const creds = getConnectionCredentialsById(connection.id);
  if (!creds) { res.status(400).json({ error: "This account has no stored credentials." }); return; }

  let result;
  try {
    result = await platform.test(creds);
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const updated = recordTestResult(
    connection.id,
    result.ok,
    result.detail ?? null,
    result.ok ? null : (result.message ?? "Connection test failed")
  );
  if (connection.platformId === "slack") refreshSlackAgentBridge();
  globalBus.emit("connections_changed");
  res.json({ result, connection: updated });
});

app.delete("/accounts/:connectionId", (req: Request, res: Response) => {
  const connection = getConnectionById(req.params.connectionId);
  if (!connection) { res.status(404).json({ error: "Account not found" }); return; }
  deleteConnection(connection.id);
  if (connection.platformId === "slack") stopSlackAgentBridge();
  globalBus.emit("connections_changed");
  res.status(204).send();
});

app.patch("/connections/:connectionId/cap", (req: Request, res: Response) => {
  const body = validatedBody(setConnectionCapSchema, req, res);
  if (!body) return;
  if (!getConnectionById(req.params.connectionId)) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const connection = setConnectionCap(req.params.connectionId, body.dailyActionCap ?? null);
  globalBus.emit("connections_changed");
  res.json(connection);
});

app.delete("/connections/:platformId", (req: Request, res: Response) => {
  const targetId = resolveConnectionId(req.params.platformId);
  if (!targetId) {
    res.status(409).json({
      error: "Several accounts exist for this platform. Delete a specific account instead.",
    });
    return;
  }
  deleteConnection(targetId);
  if (req.params.platformId === "slack") stopSlackAgentBridge();
  res.status(204).send();
});

app.get("/platform-usage", (_req: Request, res: Response) => {
  res.json(getUsageToday());
});

// ---- Stripe-funded billing ----
//
// Jarvis never moves money and never sees a PAN — see billing/stripeFunding.ts.
// These routes only ever read balance, manage which cards exist, and mint
// short-lived reveal sessions Stripe's own Issuing Elements use directly in
// the browser.

app.get("/billing/stripe/balance", async (_req: Request, res: Response) => {
  try {
    res.json(await getIssuingBalance());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not read Stripe balance" });
  }
});

app.get("/billing/stripe/cards", (_req: Request, res: Response) => {
  res.json(listStripeCards());
});

app.post("/billing/stripe/cards", async (req: Request, res: Response) => {
  const body = validatedBody(issueStripeCardSchema, req, res);
  if (!body) return;
  try {
    const card = await issueStripeCard(body);
    res.status(201).json(card);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not issue card" });
  }
});

app.delete("/billing/stripe/cards/:cardId", async (req: Request, res: Response) => {
  try {
    await cancelStripeCard(req.params.cardId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not cancel card" });
  }
});

app.post("/billing/stripe/cards/:cardId/reveal-session", async (req: Request, res: Response) => {
  const body = validatedBody(stripeRevealSessionSchema, req, res);
  if (!body) return;
  try {
    res.json(await createCardRevealSession(req.params.cardId, body.nonce));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not start a reveal session" });
  }
});

// ---- Coinbase Spend Permission spend ----
//
// Jarvis never holds a wallet private key — see billing/walletFunding.ts.
// These routes read the spender address, grant and revoke permissions on the
// operator's own wallet, and spend within one. Granting is the only one that
// widens what Jarvis can do, and it is bounded on-chain the moment it lands.

app.get("/billing/wallet/spender-address", async (_req: Request, res: Response) => {
  try {
    res.json({ address: await getSpenderAddress() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not read Jarvis's spender address" });
  }
});

app.get("/billing/wallet/permissions", async (_req: Request, res: Response) => {
  try {
    res.json(await listGrantedPermissions());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not read granted permissions" });
  }
});

/**
 * Whether a permission can be granted from here at all.
 *
 * The dashboard asks before offering the form, because the alternative is
 * letting someone fill it in and then handing them a CDP error about an
 * unowned account that tells them nothing about what to do instead.
 */
app.get("/billing/wallet/grant-capability", async (_req: Request, res: Response) => {
  try {
    res.json({ canGrant: await operatorWalletIsManaged() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not check the wallet" });
  }
});

app.post("/billing/wallet/permissions", async (req: Request, res: Response) => {
  const body = validatedBody(grantSpendPermissionSchema, req, res);
  if (!body) return;
  try {
    res.status(201).json(await grantSpendPermission(body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not grant the permission" });
  }
});

app.delete("/billing/wallet/permissions/:hash", async (req: Request, res: Response) => {
  try {
    await revokeSpendPermission(req.params.hash);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not revoke the permission" });
  }
});

app.get("/billing/wallet/spends", (_req: Request, res: Response) => {
  res.json(listWalletSpends());
});

app.post("/billing/wallet/spend", async (req: Request, res: Response) => {
  const body = validatedBody(walletSpendSchema, req, res);
  if (!body) return;
  try {
    const spend = await spendFromPermission(body);
    res.status(201).json(spend);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not spend from this permission" });
  }
});

app.get("/images", (_req: Request, res: Response) => {
  res.json({ folder: imagesFolder(), images: listImages() });
});

// ---- Storage ----

app.get("/storage", (_req: Request, res: Response) => {
  res.json(getStorageStats());
});

app.post("/storage/compact", (_req: Request, res: Response) => {
  res.json({ result: runMaintenance(), stats: getStorageStats() });
});

// ---- Notifications ----

app.get("/notifications", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  res.json({ items: listNotifications(100, agentId), unread: unreadCount(agentId) });
});

app.post("/notifications/:id/read", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  markRead(req.params.id, agentId);
  res.status(202).json({ ok: true });
});

app.post("/notifications/read-all", (req: Request, res: Response) => {
  const agentId = scopedAgentId(req, res); if (agentId === null) return;
  markAllRead(agentId);
  res.status(202).json({ ok: true });
});

// ---- Credential backup and recovery ----

app.get("/backup/database", async (_req: Request, res: Response) => {
  const path = join(tmpdir(), `jarvis-backup-${randomUUID()}.db`);
  try {
    await createDatabaseBackup(path);
    const date = new Date().toISOString().slice(0, 10);
    res.download(path, `jarvis-data-${date}.db`, (err) => {
      rm(path, { force: true }, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Could not send the database backup." });
      }
    });
  } catch (err) {
    rm(path, { force: true }, () => {});
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not create the database backup.",
    });
  }
});

app.post("/backup/export", (req: Request, res: Response) => {
  const { passphrase } = req.body as { passphrase?: string };
  if (!passphrase) {
    res.status(400).json({ error: "passphrase is required" });
    return;
  }
  const credentials = exportAllCredentials();
  if (Object.keys(credentials).length === 0) {
    res.status(400).json({ error: "There are no saved credentials to back up yet." });
    return;
  }
  try {
    res.json(createBackup(credentials, passphrase));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/backup/import", (req: Request, res: Response) => {
  const { passphrase, bundle } = req.body as {
    passphrase?: string;
    bundle?: BackupBundle;
  };
  if (!passphrase || !bundle) {
    res.status(400).json({ error: "passphrase and bundle are both required" });
    return;
  }
  try {
    const credentials = restoreBackup<Record<string, Record<string, string>>>(
      bundle,
      passphrase
    );
    const result = importCredentials(credentials);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Settings ----

app.get("/settings", (_req: Request, res: Response) => {
  res.json(getSettings());
});

app.patch("/settings", (req: Request, res: Response) => {
  const body = validatedBody(updateSettingsSchema, req, res);
  if (!body) return;
  res.json(updateSettings(body));
});

// Generated before the port opens, not on the first authenticated request.
// Lazily, `/health` — which is exempt — never triggers it, so the dashboard
// could ask this app's own server for the token before the file existed and be
// told 503 by a service that was otherwise perfectly healthy.
apiToken();

const server = app.listen(PORT, HOST, () => {
  console.log(`Jarvis orchestrator listening on http://${HOST}:${PORT}`);
  if (!PASSIVE_FALLBACK) {
    startScheduler();
    startIdleReaper();
    startMaintenance();
    startPaidGrowthMonitor();
    startSlackAgentBridge();
    startApproveServer();
  } else {
    console.log("Passive fallback mode: scheduler, idle reaper, and maintenance are disabled");
  }
  if (CONTENT_PUBLISHING_ENABLED) {
    startContentPublishingScheduler();
    console.log("Campaign content publishing scheduler enabled");
  }
  // Create it up front so the folder exists to drop files into.
  console.log(`Images folder: ${ensureImagesFolder()}`);
});

// A second listener on the same port's IPv6 loopback — see HOST_V6's comment.
// Shares the same Express app as its request handler; nothing above (startup
// tasks, scheduler, etc.) needs to run twice, so this listener has no
// callback of its own.
const serverV6 = HOST_V6 ? createServer(app).listen(PORT, HOST_V6) : null;
serverV6?.on("error", (err) => {
  // Best-effort: if IPv6 loopback isn't available on this machine at all,
  // the primary IPv4 listener above is still fully functional on its own.
  console.warn(`[http] could not also listen on [${HOST_V6}]:${PORT}:`, err instanceof Error ? err.message : err);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopSlackAgentBridge();
  markInterruptedIfActive();
  server.close(() => process.exit(0));
  // SSE and keep-alive sockets can otherwise keep server.close waiting forever,
  // leaving the compiled old service alive after a scheduled-task restart.
  server.closeAllConnections();
  serverV6?.close();
  serverV6?.closeAllConnections();
  setTimeout(() => process.exit(0), 1_500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
