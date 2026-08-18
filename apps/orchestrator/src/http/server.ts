import express from "express";
import cors from "cors";
import type { ZodType } from "zod";
import { existsSync, rm, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import {
  createSession,
  getSession,
  listSessions,
  listSessionEvents,
  markInterruptedIfActive,
  createTask,
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
import {
  listConnections,
  getConnection,
  getConnectionCredentials,
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
  permissionResponseSchema,
  saveConnectionSchema,
  updateScheduledTaskSchema,
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
  createCampaignSchema,
  updateCampaignSchema,
  createContentItemSchema,
  updateContentItemSchema,
  generateCampaignContentSchema,
  createAgentSchema,
  updateAgentSchema,
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
  createWebsiteConversationSchema,
  websiteMessageSchema,
} from "./validation.js";
import {
  createPaidGrowthCampaign,
  getPaidGrowthCampaign,
  updatePaidGrowthCampaign,
  updatePaidGrowthPerformance,
} from "../db/paidGrowthRepo.js";
import {
  decidePaidGrowthRecommendation,
  paidGrowthOverview,
  refreshPaidGrowthRecommendations,
  requestPaidGrowthLaunch,
  syncPaidGrowthCampaign,
} from "../paidGrowth/service.js";
import { startPaidGrowthMonitor } from "../paidGrowth/monitor.js";
import { listMemories, listMemoryReflections, remember, updateMemory } from "../db/memoryRepo.js";
import {
  archiveAgent,
  createAgent,
  getAgent,
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
  createCampaign,
  createCampaignGenerationRun,
  createContentItem,
  deleteCampaign,
  deleteContentItem,
  getCampaign,
  getContentItem,
  listCampaignGenerationRuns,
  listCampaigns,
  listContentItems,
  listContentPublicationRuns,
  updateCampaign,
  updateContentItem,
  recoverInterruptedCampaignRuns,
} from "../db/campaignRepo.js";
import { campaignGenerationPrompt } from "../campaigns/contentGeneration.js";
import { startContentPublication } from "../campaigns/publicationService.js";
import { startContentPublishingScheduler } from "../campaigns/publicationScheduler.js";
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
import { handleMetaWebhook, handleResendWebhook, handleXWebhook, verifyMetaWebhook, verifyXWebhook, xCrcResponse } from "../customers/webhooks.js";

const PORT = Number(process.env.PORT ?? 4317);
const HOST = process.env.HOST ?? "127.0.0.1";
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
recoverInterruptedCampaignRuns();

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
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buffer) => { (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); },
}));

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

// ---- Sessions ----

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
  const session = createSession({
    title: body.prompt.slice(0, 120),
    cwd: body.cwd,
    permissionMode: body.permissionMode ?? "default",
    allowedTools: body.allowedTools,
    taskId: body.taskId,
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
  });

  res.status(201).json(session);
});

app.get("/sessions", (_req: Request, res: Response) => {
  res.json(listSessions());
});

/**
 * The single ongoing conversation with Jarvis.
 *
 * Resumes the existing thread rather than starting another one, so talking to
 * Jarvis on Monday and Thursday is one conversation with memory instead of two
 * strangers. Automation runs deliberately keep their own sessions — each really
 * is a separate execution.
 */
app.get("/chat", (_req: Request, res: Response) => {
  const id = getPrimarySessionId();
  const session = id ? getSession(id) : undefined;
  res.json({ session: session ?? null });
});

app.post("/chat", (req: Request, res: Response) => {
  const body = validatedBody(messageSchema, req, res);
  if (!body) return;
  const { text } = body;

  const existingId = getPrimarySessionId();
  const existing = existingId ? getSession(existingId) : undefined;

  if (existing) {
    const outcome = sendFollowUp(existing.id, text, { memoryWritable: true });
    if (outcome.ok) {
      res.status(202).json({ sessionId: existing.id, resumed: outcome.resumed });
      return;
    }
    if (outcome.reason === "at_capacity") {
      res.status(429).json({
        error: `Too many sessions running at once (${activeSessionCount()}/${getSettings().maxConcurrentSessions}). Wait for one to finish.`,
      });
      return;
    }
    // unknown_session or not_resumable falls through to starting a fresh thread.
  }

  const cwd = getSettings().chatWorkingDirectory.trim() || process.cwd();
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    res.status(400).json({
      error: `Chat working directory does not exist: ${cwd}. Set it in Settings.`,
    });
    return;
  }
  if (atConcurrencyLimit()) {
    res.status(429).json({
      error: `Too many sessions running at once (${activeSessionCount()}/${getSettings().maxConcurrentSessions}).`,
    });
    return;
  }

  const session = createSession({
    title: "Jarvis",
    cwd,
    permissionMode: "default",
  });
  setPrimarySessionId(session.id);
  globalBus.emit("session_updated", session.id);
  globalBus.emit("chat_changed");

  void startSession({
    id: session.id,
    prompt: text,
    cwd,
    permissionMode: "default",
    title: "Jarvis",
    memoryWritable: true,
  });

  res.status(201).json({ sessionId: session.id, resumed: false });
});

app.delete("/sessions/:id", (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) {
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
  if (!session) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(session);
});

app.get("/sessions/:id/events", (req: Request, res: Response) => {
  const since = validatedSince(req, res);
  if (since === undefined) return;
  res.json(listSessionEvents(req.params.id, since));
});

app.get("/sessions/:id/stream", (req: Request, res: Response) => {
  const sessionId = req.params.id;
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

// ---- Durable memory ----

app.get("/memories", (req: Request, res: Response) => {
  const status = req.query.status;
  if (status !== undefined && status !== "active" && status !== "archived") {
    res.status(400).json({ error: "status must be active or archived" });
    return;
  }
  res.json(listMemories(status as "active" | "archived" | undefined));
});

app.get("/memory-reflections", (_req: Request, res: Response) => {
  res.json(listMemoryReflections());
});

app.post("/memories", (req: Request, res: Response) => {
  const body = validatedBody(createMemorySchema, req, res);
  if (!body) return;
  const result = remember(body);
  globalBus.emit("memories_changed");
  res.status(result.created ? 201 : 200).json(result.memory);
});

app.patch("/memories/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateMemorySchema, req, res);
  if (!body) return;
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
    const created = await handleResendWebhook(rawBody(req), headers, creds);
    if (created) globalBus.emit("customers_changed");
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

app.get("/customer-operations", (_req: Request, res: Response) => {
  res.json(listCustomerOperations());
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
  const created = createCustomerConversation(body);
  globalBus.emit("customers_changed");
  res.status(201).json(created);
});

app.patch("/customer-conversations/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateCustomerConversationSchema, req, res);
  if (!body) return;
  const conversation = updateCustomerConversation(req.params.id, body);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  globalBus.emit("customers_changed");
  res.json(conversation);
});

app.delete("/customer-conversations/:id", (req: Request, res: Response) => {
  if (!getCustomerConversation(req.params.id)) {
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
  if (!getCustomerConversation(req.params.id)) {
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
  try {
    res.status(201).json(startCustomerReplyDraft(req.params.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(message === "Conversation not found." ? 404 : 400).json({ error: message });
  }
});

app.post("/customer-conversations/:id/escalate", (req: Request, res: Response) => {
  const conversation = getCustomerConversation(req.params.id);
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
  });
  notify({
    type: "customer_escalation",
    severity: "warning",
    title: `Customer needs attention: ${customer?.name ?? conversation.subject}`,
    body: conversation.subject,
  });
  globalBus.emit("customers_changed");
  globalBus.emit("missions_changed");
  res.status(201).json({ conversation: updated, task });
});

app.post("/customer-conversations/:id/follow-up", (req: Request, res: Response) => {
  const conversation = getCustomerConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  const customer = getCustomer(conversation.customerId);
  const task = createTask({
    title: `Follow up with ${customer?.name ?? "customer"}`,
    description: `${conversation.subject} · ${conversation.channel} · Customer Operations`,
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
  const onCampaigns = () => sseSend(res, "campaigns-changed", {});
  globalBus.on("campaigns_changed", onCampaigns);
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

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    globalBus.off("session_updated", onUpdate);
    globalBus.off("notifications_changed", onNotifications);
    globalBus.off("missions_changed", onMissions);
    globalBus.off("evolution_changed", onEvolution);
    globalBus.off("campaigns_changed", onCampaigns);
    globalBus.off("memories_changed", onMemories);
    globalBus.off("automations_changed", onAutomations);
    globalBus.off("chat_changed", onChat);
    globalBus.off("customers_changed", onCustomers);
    globalBus.off("paid_growth_changed", onPaidGrowth);
    globalBus.off("agents_changed", onAgents);
  });
});

app.post("/sessions/:id/messages", (req: Request, res: Response) => {
  const body = validatedBody(messageSchema, req, res);
  if (!body) return;
  const { text } = body;
  const outcome = sendFollowUp(req.params.id, text);
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
  } else {
    res.status(429).json({
      error: `Too many sessions running at once (${activeSessionCount()}/${getSettings().maxConcurrentSessions}). Wait for one to finish, then try again.`,
    });
  }
});

app.post("/sessions/:id/permission-response", (req: Request, res: Response) => {
  const body = validatedBody(permissionResponseSchema, req, res);
  if (!body) return;
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
  try {
    const ok = await interruptSession(req.params.id);
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

app.get("/tasks", (_req: Request, res: Response) => {
  res.json(listTasks());
});

app.post("/tasks", (req: Request, res: Response) => {
  const body = validatedBody(createTaskSchema, req, res);
  if (!body) return;
  const { title, description, missionId } = body;
  if (missionId && !getMission(missionId)) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  const task = createTask({ title, description, missionId });
  globalBus.emit("missions_changed");
  res.status(201).json(task);
});

app.patch("/tasks/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateTaskSchema, req, res);
  if (!body) return;
  if (body.missionId && !getMission(body.missionId)) {
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
  deleteTask(req.params.id);
  globalBus.emit("missions_changed");
  res.status(204).send();
});

// ---- Missions and deliverables ----

app.get("/missions", (_req: Request, res: Response) => {
  res.json(listMissions());
});

app.post("/missions", (req: Request, res: Response) => {
  const body = validatedBody(createMissionSchema, req, res);
  if (!body) return;
  const mission = createMission(body);
  globalBus.emit("missions_changed");
  res.status(201).json(mission);
});

app.get("/missions/:id", (req: Request, res: Response) => {
  const mission = getMission(req.params.id);
  if (!mission) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  res.json({
    mission,
    tasks: listTasks().filter((task) => task.missionId === mission.id),
    deliverables: listDeliverables(mission.id),
    updates: listMissionUpdates(mission.id),
  });
});

app.patch("/missions/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateMissionSchema, req, res);
  if (!body) return;
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
  if (!mission) {
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
  });
  const prompt = `Advance the mission "${mission.title}".\n\nDesired outcome: ${mission.outcome}\n\nCurrent next action: ${mission.nextAction || "Determine the best next action."}\n\nMake concrete progress, explain what changed, and identify any deliverable or decision that needs my review.`;
  const session = createSession({
    title: mission.title,
    cwd,
    permissionMode: "default",
    taskId: task.id,
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
  if (!getMission(req.params.id)) {
    res.status(404).json({ error: "Mission not found" });
    return;
  }
  deleteMission(req.params.id);
  globalBus.emit("missions_changed");
  res.status(204).send();
});

app.get("/deliverables", (req: Request, res: Response) => {
  const missionId = typeof req.query.missionId === "string" ? req.query.missionId : undefined;
  res.json(listDeliverables(missionId));
});

app.post("/missions/:id/deliverables", (req: Request, res: Response) => {
  if (!getMission(req.params.id)) {
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
  const deliverable = updateDeliverable(req.params.id, body);
  if (!deliverable) {
    res.status(404).json({ error: "Deliverable not found" });
    return;
  }
  globalBus.emit("missions_changed");
  res.json(deliverable);
});

app.delete("/deliverables/:id", (req: Request, res: Response) => {
  deleteDeliverable(req.params.id);
  globalBus.emit("missions_changed");
  res.status(204).send();
});

app.get("/mission-updates", (_req: Request, res: Response) => {
  res.json(listMissionUpdates());
});

app.post("/mission-updates/:id/review", (req: Request, res: Response) => {
  const body = validatedBody(reviewMissionUpdateSchema, req, res);
  if (!body) return;
  const update = getMissionUpdate(req.params.id);
  if (!update) {
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

app.get("/campaigns", (_req: Request, res: Response) => {
  res.json({
    campaigns: listCampaigns(),
    content: listContentItems(),
    generationRuns: listCampaignGenerationRuns(),
    publicationRuns: listContentPublicationRuns(),
  });
});

app.post("/campaigns", (req: Request, res: Response) => {
  const body = validatedBody(createCampaignSchema, req, res);
  if (!body) return;
  if (body.missionId && !getMission(body.missionId)) {
    res.status(400).json({ error: "Mission not found" });
    return;
  }
  const campaign = createCampaign({
    ...body,
    approvalPolicy: body.approvalPolicy ?? "each_item",
  });
  globalBus.emit("campaigns_changed");
  res.status(201).json(campaign);
});

app.get("/campaigns/:id", (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({
    campaign,
    content: listContentItems(campaign.id),
    generationRuns: listCampaignGenerationRuns(campaign.id),
    publicationRuns: listContentPublicationRuns(campaign.id),
  });
});

app.patch("/campaigns/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateCampaignSchema, req, res);
  if (!body) return;
  if (body.missionId && !getMission(body.missionId)) {
    res.status(400).json({ error: "Mission not found" });
    return;
  }
  const campaign = updateCampaign(req.params.id, body);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  globalBus.emit("campaigns_changed");
  res.json(campaign);
});

app.delete("/campaigns/:id", (req: Request, res: Response) => {
  if (!getCampaign(req.params.id)) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  deleteCampaign(req.params.id);
  globalBus.emit("campaigns_changed");
  res.status(204).send();
});

app.post("/campaigns/:id/content", (req: Request, res: Response) => {
  const body = validatedBody(createContentItemSchema, req, res);
  if (!body) return;
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!campaign.channels.includes(body.channel)) {
    res.status(400).json({ error: `${body.channel} is not an approved channel for this campaign` });
    return;
  }
  const item = createContentItem({ campaignId: campaign.id, ...body });
  globalBus.emit("campaigns_changed");
  res.status(201).json(item);
});

app.patch("/content/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateContentItemSchema, req, res);
  if (!body) return;
  const current = getContentItem(req.params.id);
  if (!current) {
    res.status(404).json({ error: "Content item not found" });
    return;
  }
  const campaign = getCampaign(current.campaignId);
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
  globalBus.emit("campaigns_changed");
  res.json(item);
});

app.delete("/content/:id", (req: Request, res: Response) => {
  if (!getContentItem(req.params.id)) {
    res.status(404).json({ error: "Content item not found" });
    return;
  }
  deleteContentItem(req.params.id);
  globalBus.emit("campaigns_changed");
  res.status(204).send();
});

app.post("/content/:id/publish", (req: Request, res: Response) => {
  const item = getContentItem(req.params.id);
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

app.post("/campaigns/:id/generate", (req: Request, res: Response) => {
  const body = validatedBody(generateCampaignContentSchema, req, res);
  if (!body) return;
  const campaign = getCampaign(req.params.id);
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
  });
  const generationRun = createCampaignGenerationRun({
    campaignId: campaign.id,
    sessionId: session.id,
    requestedCount: body.count,
  });
  if (campaign.status === "draft") updateCampaign(campaign.id, { status: "active" });
  globalBus.emit("session_updated", session.id);
  globalBus.emit("campaigns_changed");

  void startSession({
    id: session.id,
    prompt: campaignGenerationPrompt({ campaign, ...body, channels }),
    cwd: session.cwd,
    permissionMode: "default",
    allowedTools: [],
    title: session.title,
    isolated: true,
  });

  res.status(201).json({ campaign: getCampaign(campaign.id), session, generationRun });
});

// ---- Scheduled tasks ----

app.get("/scheduled-tasks", (_req: Request, res: Response) => {
  res.json(listScheduledTasks());
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
  const next = computeNextRun(body.timeOfDay, body.daysOfWeek, new Date());
  const task = createScheduledTask({
    prompt: body.prompt,
    cwd: body.cwd,
    permissionMode: body.permissionMode ?? "default",
    allowedTools: body.allowedTools,
    timeOfDay: body.timeOfDay,
    daysOfWeek: body.daysOfWeek,
    nextRunAt: next ? next.toISOString() : new Date().toISOString(),
  });
  globalBus.emit("automations_changed");
  res.status(201).json(task);
});

app.patch("/scheduled-tasks/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateScheduledTaskSchema, req, res);
  if (!body) return;
  const existing = getScheduledTask(req.params.id);
  if (!existing) {
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
  if (!task) {
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
  deleteScheduledTask(req.params.id);
  globalBus.emit("automations_changed");
  res.status(204).send();
});

// ---- Jarvis evolution and Lab ----

app.get("/evolution", (_req: Request, res: Response) => {
  ensureEvolutionBootstrap();
  res.json({
    proposals: listEvolutionProposals(),
    policies: listEvolutionPolicies(),
    readiness: evolutionReadiness(),
  });
});

app.post("/evolution/proposals", (req: Request, res: Response) => {
  const body = validatedBody(createEvolutionProposalSchema, req, res);
  if (!body) return;
  const proposal = createEvolutionProposal(body);
  globalBus.emit("evolution_changed");
  res.status(201).json(proposal);
});

app.patch("/evolution/proposals/:id", (req: Request, res: Response) => {
  const body = validatedBody(updateEvolutionProposalSchema, req, res);
  if (!body) return;
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
  const proposal = getEvolutionProposal(req.params.id);
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

// ---- Paid Growth Control ----

app.get("/paid-growth", (_req: Request, res: Response) => {
  res.json(paidGrowthOverview());
});

app.post("/paid-growth/campaigns", (req: Request, res: Response) => {
  const body = validatedBody(createPaidGrowthCampaignSchema, req, res);
  if (!body) return;
  if (body.campaignId && !getCampaign(body.campaignId)) {
    res.status(400).json({ error: "Linked campaign not found" });
    return;
  }
  const campaign = createPaidGrowthCampaign(body);
  globalBus.emit("paid_growth_changed");
  res.status(201).json(campaign);
});

app.patch("/paid-growth/campaigns/:id", (req: Request, res: Response) => {
  const body = validatedBody(updatePaidGrowthCampaignSchema, req, res);
  if (!body) return;
  const current = getPaidGrowthCampaign(req.params.id);
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

app.post("/paid-growth/campaigns/:id/performance", (req: Request, res: Response) => {
  const body = validatedBody(updatePaidGrowthPerformanceSchema, req, res);
  if (!body) return;
  const current = getPaidGrowthCampaign(req.params.id);
  if (!current) {
    res.status(404).json({ error: "Paid campaign not found" });
    return;
  }
  if (body.spentMinor < current.spentMinor) {
    res.status(400).json({ error: "Cumulative spend cannot move backward" });
    return;
  }
  const campaign = updatePaidGrowthPerformance(current.id, body);
  globalBus.emit("paid_growth_changed");
  res.json(campaign);
});

app.post("/paid-growth/campaigns/:id/sync", async (req: Request, res: Response) => {
  try {
    const result = await syncPaidGrowthCampaign(req.params.id);
    for (const decision of result.decisions) {
      notify({
        type: "paid_growth_approval",
        severity: decision.kind === "pause" ? "warning" : "info",
        title: "Paid growth decision ready",
        body: `${result.campaign.name}: ${decision.reason}`,
      });
    }
    globalBus.emit("paid_growth_changed");
    res.json({ ...result, overview: paidGrowthOverview() });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/paid-growth/campaigns/:id/request-launch", (req: Request, res: Response) => {
  try {
    const decision = requestPaidGrowthLaunch(req.params.id);
    const campaign = getPaidGrowthCampaign(req.params.id)!;
    notify({
      type: "paid_growth_approval",
      severity: "warning",
      title: "Paid campaign needs approval",
      body: `${campaign.name} is ready for a ${campaign.dailyBudgetMinor} ${campaign.currency} minor-unit daily envelope.`,
    });
    globalBus.emit("paid_growth_changed");
    res.status(201).json(decision);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/paid-growth/recommendations/refresh", (_req: Request, res: Response) => {
  const decisions = refreshPaidGrowthRecommendations();
  for (const decision of decisions) {
    const campaign = getPaidGrowthCampaign(decision.paidCampaignId);
    notify({
      type: "paid_growth_approval",
      severity: decision.kind === "pause" ? "warning" : "info",
      title: "Paid growth decision ready",
      body: `${campaign?.name ?? "A paid campaign"}: ${decision.reason}`,
    });
  }
  globalBus.emit("paid_growth_changed");
  res.json({ created: decisions, overview: paidGrowthOverview() });
});

app.post("/paid-growth/decisions/:id/review", async (req: Request, res: Response) => {
  const body = validatedBody(reviewPaidGrowthDecisionSchema, req, res);
  if (!body) return;
  try {
    const decision = await decidePaidGrowthRecommendation(req.params.id, body.decision);
    globalBus.emit("paid_growth_changed");
    res.json({ decision, overview: paidGrowthOverview() });
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
  // Blank fields mean "leave as-is" so re-editing doesn't wipe secrets the user
  // no longer has a copy of (most platforms show them exactly once).
  const merged: Record<string, string> = {
    ...(getConnectionCredentials(platform.definition.id) ?? {}),
  };
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
  res.json(saveConnection(platform.definition.id, merged));
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
  const connection = recordTestResult(
    platform.definition.id,
    result.ok,
    result.detail ?? null,
    result.ok ? null : (result.message ?? "Connection test failed")
  );
  res.json({ result, connection });
});

app.delete("/connections/:platformId", (req: Request, res: Response) => {
  deleteConnection(req.params.platformId);
  res.status(204).send();
});

app.get("/platform-usage", (_req: Request, res: Response) => {
  res.json(getUsageToday());
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

app.get("/notifications", (_req: Request, res: Response) => {
  res.json({ items: listNotifications(), unread: unreadCount() });
});

app.post("/notifications/:id/read", (req: Request, res: Response) => {
  markRead(req.params.id);
  res.status(202).json({ ok: true });
});

app.post("/notifications/read-all", (_req: Request, res: Response) => {
  markAllRead();
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

const server = app.listen(PORT, HOST, () => {
  console.log(`Jarvis orchestrator listening on http://${HOST}:${PORT}`);
  if (!PASSIVE_FALLBACK) {
    startScheduler();
    startIdleReaper();
    startMaintenance();
    startPaidGrowthMonitor();
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

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  markInterruptedIfActive();
  server.close(() => process.exit(0));
  // SSE and keep-alive sockets can otherwise keep server.close waiting forever,
  // leaving the compiled old service alive after a scheduled-task restart.
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 1_500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
