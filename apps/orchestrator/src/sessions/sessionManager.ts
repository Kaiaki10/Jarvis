import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { appendSessionEvent, updateSession } from "../db/repo.js";
import type { SessionEventRecord } from "@jarvis/shared";
import { createPushable, type Pushable } from "./pushableIterable.js";
import { globalBus } from "../events/globalBus.js";

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
}

interface SessionHandle {
  emitter: EventEmitter;
  input: Pushable<SDKUserMessage>;
  pendingPermissions: Map<string, PendingPermission>;
  claudeSessionId: string | null;
  interrupt: () => Promise<void>;
}

const sessions = new Map<string, SessionHandle>();

export function getSessionEmitter(id: string): EventEmitter | undefined {
  return sessions.get(id)?.emitter;
}

export function sendFollowUp(sessionId: string, text: string): boolean {
  const handle = sessions.get(sessionId);
  if (!handle) return false;
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
    pending.resolve({ behavior: "allow", updatedInput: updatedInput ?? {} });
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
    return new Promise<PermissionResult>((resolve) => {
      pendingPermissions.set(requestId, { resolve });
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

  try {
    const q = query({
      prompt: input,
      options: {
        cwd: params.cwd,
        permissionMode: params.permissionMode as PermissionMode,
        allowedTools: params.allowedTools,
        includePartialMessages: true,
        canUseTool,
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

      const event: SessionEventRecord = appendSessionEvent(
        params.id,
        message.type,
        message
      );
      emitter.emit("event", event);

      if (message.type === "result") {
        // Streaming-input sessions stay alive after a result, ready for a follow-up —
        // "idle" reflects that; "completed" is reserved for an explicitly closed session.
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
    updateSession(params.id, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
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
