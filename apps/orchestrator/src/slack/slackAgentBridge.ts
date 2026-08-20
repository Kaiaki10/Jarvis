import { createHash } from "node:crypto";
import type { SessionEventRecord } from "@jarvis/shared";
import { getConnection, getConnectionCredentials, recordTestResult } from "../db/connectionsRepo.js";
import { bindSlackThread, claimSlackEvent, getSlackThreadBinding } from "../db/slackRepo.js";
import { listSessionEvents } from "../db/repo.js";
import { getDefaultAgent, listAgents } from "../db/agentRepo.js";
import { globalBus } from "../events/globalBus.js";
import { sendAgentChat } from "../agents/agentChat.js";
import { parseSlackUserIds, routeSlackMessage } from "./slackRouting.js";

interface SlackSocketEnvelope {
  envelope_id?: string;
  type?: string;
  payload?: {
    type?: string;
    event_id?: string;
    team_id?: string;
    event?: SlackEvent;
  };
}

interface SlackEvent {
  type?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
  url?: string;
  team_id?: string;
  user_id?: string;
}

let socket: WebSocket | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;
let stopped = true;
let generation = 0;
let reconnectDelayMs = 1_000;
const agentQueues = new Map<string, Promise<void>>();

async function slackApi(method: string, token: string, body?: Record<string, unknown>): Promise<SlackApiResponse> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json() as SlackApiResponse;
  if (!response.ok || !data.ok) throw new Error(data.error ?? `Slack returned HTTP ${response.status}`);
  return data;
}

function chunks(text: string, max = 3_500): string[] {
  const value = text.trim() || "Done.";
  const output: string[] = [];
  let rest = value;
  while (rest.length > max) {
    let at = rest.lastIndexOf("\n", max);
    if (at < max / 2) at = rest.lastIndexOf(" ", max);
    if (at < max / 2) at = max;
    output.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) output.push(rest);
  return output;
}

async function postMessage(botToken: string, channel: string, text: string, threadTs?: string): Promise<void> {
  for (const part of chunks(text)) {
    await slackApi("chat.postMessage", botToken, {
      channel,
      text: part,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
  }
}

function resultFromEvent(event: SessionEventRecord): { done: boolean; text?: string; error?: string; permission?: boolean } {
  if (event.type === "permission_request") return { done: false, permission: true };
  if (event.type !== "result" || !event.payload || typeof event.payload !== "object") return { done: false };
  const payload = event.payload as { result?: unknown; is_error?: boolean; errors?: unknown };
  if (payload.is_error) {
    const details = Array.isArray(payload.errors) ? payload.errors.join("; ") : "The agent run failed.";
    return { done: true, error: details };
  }
  return { done: true, text: typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result ?? "Done.") };
}

function waitForResult(
  sessionId: string,
  afterSeq: number,
  onPermission: () => void,
  timeoutMs = 15 * 60_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let permissionReported = false;
    const finish = (event: SessionEventRecord): boolean => {
      if (event.sessionId !== sessionId || event.seq <= afterSeq) return false;
      const result = resultFromEvent(event);
      if (result.permission && !permissionReported) {
        permissionReported = true;
        onPermission();
      }
      if (!result.done) return false;
      cleanup();
      if (result.error) reject(new Error(result.error));
      else resolve(result.text ?? "Done.");
      return true;
    };
    const onEvent = (event: SessionEventRecord) => { finish(event); };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The agent did not finish within 15 minutes. Its run is still visible in Jarvis."));
    }, timeoutMs);
    timeout.unref();
    const cleanup = () => {
      clearTimeout(timeout);
      globalBus.off("session_event", onEvent);
    };

    globalBus.on("session_event", onEvent);
    for (const event of listSessionEvents(sessionId, afterSeq)) {
      if (finish(event)) break;
    }
  });
}

function enqueue(agentId: string, job: () => Promise<void>): void {
  const previous = agentQueues.get(agentId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(job);
  agentQueues.set(agentId, next);
  void next.catch((error) => console.error("[slack] agent turn failed:", error)).finally(() => {
    if (agentQueues.get(agentId) === next) agentQueues.delete(agentId);
  });
}

async function handleEvent(envelope: SlackSocketEnvelope, botToken: string, workspaceId: string): Promise<void> {
  const payload = envelope.payload;
  const event = payload?.event;
  if (!payload?.event_id || !event?.user || !event.channel || !event.ts || !event.text) return;
  if (event.bot_id || event.subtype) return;
  const isMention = event.type === "app_mention";
  const isDirectMessage = event.type === "message" && event.channel_type === "im";
  if (!isMention && !isDirectMessage) return;

  const creds = getConnectionCredentials("slack");
  if (!creds) return;
  const allowed = parseSlackUserIds(creds.allowedUserIds);
  const replyThreadTs = event.thread_ts ?? (isMention ? event.ts : undefined);
  if (allowed.size && !allowed.has(event.user)) {
    await postMessage(botToken, event.channel, "You are not on this Jarvis connection's allowed-user list.", replyThreadTs);
    return;
  }

  const eventWorkspaceId = payload.team_id ?? workspaceId;
  const hash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  if (!claimSlackEvent(eventWorkspaceId, payload.event_id, hash)) return;

  const externalThreadId = event.thread_ts ?? (isDirectMessage ? `dm:${event.user}` : event.ts);
  const binding = getSlackThreadBinding(eventWorkspaceId, event.channel, externalThreadId);
  const agents = listAgents("active");
  const defaultAgent = getDefaultAgent();
  const cleaned = event.text.replace(/<@[A-Z0-9]+>/gi, " ").trim();
  if (/^agents\s*$/i.test(cleaned)) {
    const names = agents.map((agent) => `• *${agent.name}* — ${agent.role || "Agent"}`).join("\n");
    await postMessage(botToken, event.channel, `Available agents:\n${names}\n\nUse \`Agent Name: your message\` to choose one.`, replyThreadTs);
    return;
  }

  const route = routeSlackMessage(event.text, agents, binding?.agentId, defaultAgent?.id);
  if (/^\/?agent\b/i.test(cleaned) && !route.explicit) {
    await postMessage(botToken, event.channel, "I couldn't match that agent. Send `agents` to see the exact names.", replyThreadTs);
    return;
  }
  if (!route.agent) {
    await postMessage(botToken, event.channel, "No active Jarvis agent is available.", replyThreadTs);
    return;
  }
  if (!route.text) {
    await postMessage(botToken, event.channel, `What would you like ${route.agent.name} to do?`, replyThreadTs);
    return;
  }

  bindSlackThread({
    workspaceId: eventWorkspaceId,
    channelId: event.channel,
    externalThreadId,
    agentId: route.agent.id,
    userId: event.user,
  });

  enqueue(route.agent.id, async () => {
    const outcome = sendAgentChat(route.agent!.id, route.text);
    if (!outcome.ok) {
      await postMessage(botToken, event.channel!, outcome.message, replyThreadTs);
      return;
    }
    try {
      const answer = await waitForResult(outcome.sessionId, outcome.afterSeq, () => {
        void postMessage(
          botToken,
          event.channel!,
          `${route.agent!.name} is waiting for approval in the local Jarvis dashboard. I’ll continue here after you decide.`,
          replyThreadTs
        ).catch((error) => console.error("[slack] could not post approval notice:", error));
      });
      await postMessage(botToken, event.channel!, `*${route.agent!.name}*\n${answer}`, replyThreadTs);
    } catch (error) {
      await postMessage(botToken, event.channel!, `${route.agent!.name} could not complete that turn: ${error instanceof Error ? error.message : String(error)}`, replyThreadTs);
    }
  });
}

function scheduleReconnect(runGeneration: number): void {
  if (stopped || runGeneration !== generation || reconnectTimer) return;
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connect(runGeneration);
  }, delay);
  reconnectTimer.unref();
}

async function decodeSlackFrame(data: unknown): Promise<string | undefined> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (data && typeof data === "object" && "text" in data && typeof data.text === "function") {
    return String(await data.text());
  }
  return undefined;
}

async function connect(runGeneration: number): Promise<void> {
  if (stopped || runGeneration !== generation) return;
  const connection = getConnection("slack");
  const creds = getConnectionCredentials("slack");
  if (connection?.status !== "connected") return;
  if (!creds?.botToken || !creds.appToken) {
    recordTestResult(
      "slack",
      false,
      null,
      "Real-time agent chat needs both the Bot User OAuth Token and the Socket Mode App Token. Add the missing token and test again."
    );
    console.warn("[slack] connection needs both botToken and appToken; open Connections → Slack to finish setup");
    return;
  }
  try {
    const [socketInfo, identity] = await Promise.all([
      slackApi("apps.connections.open", creds.appToken),
      slackApi("auth.test", creds.botToken),
    ]);
    if (!socketInfo.url) throw new Error("Slack did not return a Socket Mode URL.");
    if (stopped || runGeneration !== generation) return;
    const next = new WebSocket(socketInfo.url);
    socket = next;
    next.addEventListener("open", () => {
      reconnectDelayMs = 1_000;
      console.log(`[slack] agent channel connected${identity.team_id ? ` to workspace ${identity.team_id}` : ""}`);
    });
    next.addEventListener("message", (message) => {
      void (async () => {
        const raw = await decodeSlackFrame(message.data);
        if (!raw) {
          console.warn(`[slack] ignored unsupported Socket Mode frame (${Object.prototype.toString.call(message.data)})`);
          return;
        }
        let envelope: SlackSocketEnvelope;
        try { envelope = JSON.parse(raw) as SlackSocketEnvelope; }
        catch {
          console.warn(`[slack] ignored malformed Socket Mode frame (${raw.length} bytes)`);
          return;
        }
        // Slack expects the envelope acknowledgement immediately, before agent work.
        if (envelope.envelope_id && next.readyState === WebSocket.OPEN) {
          next.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        }
        if (envelope.type === "hello") console.log("[slack] Socket Mode handshake ready");
        if (envelope.type === "events_api") {
          const event = envelope.payload?.event;
          console.log(`[slack] received ${event?.type ?? "unknown"}${event?.channel_type ? `.${event.channel_type}` : ""}`);
        }
        if (envelope.type === "disconnect") {
          next.close();
          return;
        }
        await handleEvent(envelope, creds.botToken, identity.team_id ?? "unknown");
      })().catch((error) => console.error("[slack] inbound event failed:", error));
    });
    next.addEventListener("close", () => {
      if (socket === next) socket = undefined;
      scheduleReconnect(runGeneration);
    });
    next.addEventListener("error", () => next.close());
  } catch (error) {
    console.error("[slack] connection failed:", error instanceof Error ? error.message : String(error));
    scheduleReconnect(runGeneration);
  }
}

export function startSlackAgentBridge(): void {
  stopped = false;
  generation += 1;
  void connect(generation);
}

export function refreshSlackAgentBridge(): void {
  stopSlackAgentBridge();
  startSlackAgentBridge();
}

export function stopSlackAgentBridge(): void {
  stopped = true;
  generation += 1;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  const active = socket;
  socket = undefined;
  active?.close();
}
