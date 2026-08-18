import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { appendSessionEvent, getSettings, updateSession } from "../db/repo.js";
import type { SessionEventRecord } from "@jarvis/shared";
import { createPushable, type Pushable } from "./pushableIterable.js";
import { globalBus } from "../events/globalBus.js";
import { buildPlatformToolset } from "../platforms/actions.js";
import { notify } from "../notifications/notifier.js";

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  /** Falling back to this on approve matters — `{}` would run the tool with no arguments. */
  originalInput: Record<string, unknown>;
}

interface SessionHandle {
  emitter: EventEmitter;
  input: Pushable<SDKUserMessage>;
  pendingPermissions: Map<string, PendingPermission>;
  claudeSessionId: string | null;
  interrupt: () => Promise<void>;
  /** Mid-turn. Idle sessions stay open for follow-ups but occupy no work slot. */
  working: boolean;
  lastActivityAt: number;
}

const sessions = new Map<string, SessionHandle>();

/**
 * Streaming-input sessions never end on their own — the generator stays open so
 * follow-ups can be pushed, which keeps a Claude Code subprocess alive too. Left
 * alone they accumulate for the life of the process, so idle ones get reaped.
 */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REAP_INTERVAL_MS = 60 * 1000;

export function getSessionEmitter(id: string): EventEmitter | undefined {
  return sessions.get(id)?.emitter;
}

/** Sessions actively mid-turn. Idle ones are excluded — they aren't doing work. */
export function activeSessionCount(): number {
  let count = 0;
  for (const handle of sessions.values()) if (handle.working) count++;
  return count;
}

export function atConcurrencyLimit(): boolean {
  return activeSessionCount() >= getSettings().maxConcurrentSessions;
}

export function startIdleReaper(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, handle] of sessions) {
      if (handle.working) continue;
      if (now - handle.lastActivityAt < IDLE_TIMEOUT_MS) continue;
      updateSession(id, { status: "completed" });
      globalBus.emit("session_updated", id);
      handle.input.close();
    }
  }, REAP_INTERVAL_MS);
}

export function sendFollowUp(sessionId: string, text: string): boolean {
  const handle = sessions.get(sessionId);
  if (!handle) return false;
  handle.working = true;
  handle.lastActivityAt = Date.now();
  handle.input.push({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    session_id: handle.claudeSessionId ?? "",
  });
  return true;
}

export function resolvePermission(
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny",
  updatedInput?: Record<string, unknown>
): boolean {
  const handle = sessions.get(sessionId);
  const pending = handle?.pendingPermissions.get(requestId);
  if (!handle || !pending) return false;
  handle.pendingPermissions.delete(requestId);
  if (decision === "allow") {
    pending.resolve({
      behavior: "allow",
      updatedInput: updatedInput ?? pending.originalInput,
    });
  } else {
    pending.resolve({ behavior: "deny", message: "Denied by user via dashboard" });
  }
  // Must be emitted, not just persisted: the UI clears its approval prompt off
  // the back of this event arriving on the stream.
  const event = appendSessionEvent(sessionId, "permission_response", {
    requestId,
    decision,
  });
  handle.emitter.emit("event", event);
  updateSession(sessionId, { status: "running" });
  globalBus.emit("session_updated", sessionId);
  return true;
}

export async function interruptSession(sessionId: string): Promise<boolean> {
  const handle = sessions.get(sessionId);
  if (!handle) return false;
  await handle.interrupt();
  return true;
}

export interface StartSessionParams {
  id: string;
  prompt: string;
  cwd: string;
  permissionMode: string;
  allowedTools?: string[];
  /** Human-readable label used in notifications. */
  title?: string;
}

// Kicked off fire-and-forget from the HTTP layer; runs for the lifetime of the session.
export async function startSession(params: StartSessionParams): Promise<void> {
  const emitter = new EventEmitter();
  const input = createPushable<SDKUserMessage>();
  const pendingPermissions = new Map<string, PendingPermission>();

  const handle: SessionHandle = {
    emitter,
    input,
    pendingPermissions,
    claudeSessionId: null,
    interrupt: async () => {},
    working: true,
    lastActivityAt: Date.now(),
  };
  sessions.set(params.id, handle);

  const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
    const requestId = randomUUID();
    const event = appendSessionEvent(params.id, "permission_request", {
      requestId,
      toolName,
      input: toolInput,
      toolUseID: options.toolUseID,
    });
    updateSession(params.id, { status: "waiting_permission" });
    globalBus.emit("session_updated", params.id);
    emitter.emit("event", event);

    // Reach the user out of band — an unattended run blocking here is invisible
    // until someone happens to open the dashboard.
    notify({
      type: "approval_needed",
      severity: "warning",
      title: "Approval needed",
      body: `${params.title ?? "A session"} is waiting on you to approve ${toolName.replace(/^mcp__jarvis__/, "")}.`,
      sessionId: params.id,
    });
    return new Promise<PermissionResult>((resolve) => {
      pendingPermissions.set(requestId, { resolve, originalInput: toolInput });
    });
  };

  // First turn — session_id is unknown until the SDK's init message arrives.
  input.push({
    type: "user",
    message: { role: "user", content: params.prompt },
    parent_tool_use_id: null,
    session_id: "",
  });

  updateSession(params.id, { status: "running" });
  globalBus.emit("session_updated", params.id);

  const { businessContext } = getSettings();
  const toolset = buildPlatformToolset();
  const systemPromptAppend = [businessContext.trim(), toolset.capabilitySummary]
    .filter(Boolean)
    .join("\n\n");

  try {
    const q = query({
      prompt: input,
      options: {
        cwd: params.cwd,
        permissionMode: params.permissionMode as PermissionMode,
        allowedTools: params.allowedTools,
        includePartialMessages: true,
        canUseTool,
        // Durable business knowledge plus what this session can actually act on —
        // without these every session starts amnesiac and unaware of its tools.
        ...(systemPromptAppend
          ? {
              systemPrompt: {
                type: "preset" as const,
                preset: "claude_code" as const,
                append: systemPromptAppend,
              },
            }
          : {}),
        ...(toolset.mcpServers ? { mcpServers: toolset.mcpServers } : {}),
        stderr: (data) => {
          process.stderr.write(`[claude-cli stderr] ${data}`);
        },
      },
    });
    handle.interrupt = () => q.interrupt();

    for await (const message of q) {
      if (message.session_id) {
        handle.claudeSessionId = message.session_id;
      }
      handle.lastActivityAt = Date.now();

      const event: SessionEventRecord = appendSessionEvent(
        params.id,
        message.type,
        message
      );
      emitter.emit("event", event);

      if (message.type === "result") {
        // Streaming-input sessions stay alive after a result, ready for a follow-up —
        // "idle" reflects that; "completed" is reserved for an explicitly closed session.
        handle.working = false;
        if (message.is_error) {
          notify({
            type: "session_failed",
            severity: "error",
            title: "Session failed",
            body: `${params.title ?? "A session"} ended with an error.`,
            sessionId: params.id,
          });
        }
        updateSession(params.id, {
          status: message.is_error ? "error" : "idle",
          claudeSessionId: handle.claudeSessionId ?? undefined,
          costUsd: message.total_cost_usd,
          turns: message.num_turns,
          errorMessage:
            message.is_error && "errors" in message
              ? message.errors.join("; ")
              : undefined,
        });
      } else {
        updateSession(params.id, {
          status: "running",
          claudeSessionId: handle.claudeSessionId ?? undefined,
        });
      }
      globalBus.emit("session_updated", params.id);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    updateSession(params.id, { status: "error", errorMessage: detail });
    notify({
      type: "session_failed",
      severity: "error",
      title: "Session failed to run",
      body: `${params.title ?? "A session"} could not start or crashed: ${detail}`,
      sessionId: params.id,
    });
    globalBus.emit("session_updated", params.id);
    emitter.emit(
      "event",
      appendSessionEvent(params.id, "system", { error: String(err) })
    );
  } finally {
    input.close();
    sessions.delete(params.id);
    emitter.emit("closed");
  }
}
