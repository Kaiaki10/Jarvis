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
} from "../db/repo.js";
import {
  startSession,
  sendFollowUp,
  resolvePermission,
  interruptSession,
  getSessionEmitter,
} from "../sessions/sessionManager.js";
import { globalBus } from "../events/globalBus.js";
import type {
  CreateSessionRequest,
  PermissionResponseRequest,
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

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    globalBus.off("session_updated", onUpdate);
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

const server = app.listen(PORT, () => {
  console.log(`Jarvis orchestrator listening on http://localhost:${PORT}`);
});

function shutdown() {
  markInterruptedIfActive();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
