import express from "express";
import cors from "cors";
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
} from "../db/repo.js";
import {
  startSession,
  sendFollowUp,
  resolvePermission,
  interruptSession,
  getSessionEmitter,
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
import {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
} from "../notifications/notifier.js";
import { computeNextRun, startScheduler } from "../scheduler/scheduler.js";
import { globalBus } from "../events/globalBus.js";
import type {
  CreateSessionRequest,
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
  UpdateSettingsRequest,
  PermissionResponseRequest,
  SaveConnectionRequest,
} from "@jarvis/shared";

const PORT = Number(process.env.PORT ?? 4317);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

// A previous orchestrator process may have died mid-session; those sessions
// can't be reattached, so surface them as interrupted rather than stuck "running".
markInterruptedIfActive();

const app = express();
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json());

function sseHeaders(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function sseSend(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---- Sessions ----

app.post("/sessions", (req: Request, res: Response) => {
  const body = req.body as CreateSessionRequest;
  if (!body.prompt || !body.cwd) {
    res.status(400).json({ error: "prompt and cwd are required" });
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

app.get("/sessions/:id", (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(session);
});

app.get("/sessions/:id/events", (req: Request, res: Response) => {
  const since = Number(req.query.since ?? 0);
  res.json(listSessionEvents(req.params.id, since));
});

app.get("/sessions/:id/stream", (req: Request, res: Response) => {
  const sessionId = req.params.id;
  const since = Number(req.query.since ?? 0);
  sseHeaders(res);

  // Replay anything persisted since the client's last-seen seq, then tail live events.
  for (const event of listSessionEvents(sessionId, since)) {
    sseSend(res, "session-event", event);
  }

  const emitter = getSessionEmitter(sessionId);
  const onEvent = (event: unknown) => sseSend(res, "session-event", event);
  emitter?.on("event", onEvent);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    emitter?.off("event", onEvent);
  });
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

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    globalBus.off("session_updated", onUpdate);
    globalBus.off("notifications_changed", onNotifications);
  });
});

app.post("/sessions/:id/messages", (req: Request, res: Response) => {
  const { text } = req.body as { text: string };
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  const ok = sendFollowUp(req.params.id, text);
  if (!ok) {
    res.status(404).json({ error: "session not active" });
    return;
  }
  res.status(202).json({ ok: true });
});

app.post("/sessions/:id/permission-response", (req: Request, res: Response) => {
  const body = req.body as PermissionResponseRequest;
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
  const ok = await interruptSession(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "session not active" });
    return;
  }
  res.status(202).json({ ok: true });
});

// ---- Tasks ----

app.get("/tasks", (_req: Request, res: Response) => {
  res.json(listTasks());
});

app.post("/tasks", (req: Request, res: Response) => {
  const { title, description } = req.body as {
    title: string;
    description?: string;
  };
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  res.status(201).json(createTask({ title, description }));
});

app.patch("/tasks/:id", (req: Request, res: Response) => {
  const task = updateTask(req.params.id, req.body);
  if (!task) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(task);
});

app.delete("/tasks/:id", (req: Request, res: Response) => {
  deleteTask(req.params.id);
  res.status(204).send();
});

// ---- Scheduled tasks ----

app.get("/scheduled-tasks", (_req: Request, res: Response) => {
  res.json(listScheduledTasks());
});

app.post("/scheduled-tasks", (req: Request, res: Response) => {
  const body = req.body as CreateScheduledTaskRequest;
  if (!body.prompt || !body.cwd || !body.timeOfDay || !body.daysOfWeek?.length) {
    res
      .status(400)
      .json({ error: "prompt, cwd, timeOfDay, and at least one day of week are required" });
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
  res.status(201).json(task);
});

app.patch("/scheduled-tasks/:id", (req: Request, res: Response) => {
  const body = req.body as UpdateScheduledTaskRequest;
  const existing = getScheduledTask(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "not found" });
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
  res.json(task);
});

app.delete("/scheduled-tasks/:id", (req: Request, res: Response) => {
  deleteScheduledTask(req.params.id);
  res.status(204).send();
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
  const submitted = (req.body as SaveConnectionRequest).values ?? {};
  // Blank fields mean "leave as-is" so re-editing doesn't wipe secrets the user
  // no longer has a copy of (most platforms show them exactly once).
  const merged: Record<string, string> = {
    ...(getConnectionCredentials(platform.definition.id) ?? {}),
  };
  for (const [key, value] of Object.entries(submitted)) {
    if (String(value ?? "").trim()) merged[key] = String(value);
  }

  const missing = platform.definition.fields
    .filter((f) => !f.optional && !String(merged[f.key] ?? "").trim())
    .map((f) => f.label);
  if (missing.length) {
    res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
    return;
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
  const body = req.body as UpdateSettingsRequest;
  if (
    body.maxConcurrentSessions !== undefined &&
    (!Number.isInteger(body.maxConcurrentSessions) ||
      body.maxConcurrentSessions < 1 ||
      body.maxConcurrentSessions > 10)
  ) {
    res.status(400).json({ error: "maxConcurrentSessions must be an integer from 1 to 10" });
    return;
  }
  res.json(updateSettings(body));
});

const server = app.listen(PORT, () => {
  console.log(`Jarvis orchestrator listening on http://localhost:${PORT}`);
  startScheduler();
  startIdleReaper();
});

function shutdown() {
  markInterruptedIfActive();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
