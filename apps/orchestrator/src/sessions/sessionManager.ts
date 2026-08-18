import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  appendSessionEvent,
  getSession,
  getSettings,
  updateSession,
} from "../db/repo.js";
import type { SessionEventRecord } from "@jarvis/shared";
import { createPushable, type Pushable } from "./pushableIterable.js";
import { createDeferredWithTimeout } from "./deferredWithTimeout.js";
import { describeActivity, extractSummary } from "./describeActivity.js";
import { globalBus } from "../events/globalBus.js";
import { buildPlatformToolset } from "../platforms/actions.js";
import { estimateActionCost } from "../platforms/spendGuard.js";
import { notify } from "../notifications/notifier.js";

interface PendingPermission {
  /** Returns false if the request was already answered or timed out. */
  settle: (result: PermissionResult) => boolean;
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

export type FollowUpOutcome =
  | { ok: true; resumed: boolean }
  | { ok: false; reason: "unknown_session" | "not_resumable" | "at_capacity" };

/**
 * Continues a conversation, transparently reviving it if the session was reaped.
 *
 * Reaping frees the Claude Code subprocess after 30 minutes idle, which used to
 * make follow-ups fail outright. The SDK can resume from the stored
 * claudeSessionId, so from the caller's side the conversation just continues —
 * the transcript keeps appending to the same session row either way.
 */
export function sendFollowUp(sessionId: string, text: string): FollowUpOutcome {
  const handle = sessions.get(sessionId);

  if (handle) {
    handle.working = true;
    handle.lastActivityAt = Date.now();
    handle.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: handle.claudeSessionId ?? "",
    });
    return { ok: true, resumed: false };
  }

  const record = getSession(sessionId);
  if (!record) return { ok: false, reason: "unknown_session" };
  if (!record.claudeSessionId) {
    // Never reached the SDK — usually a session that failed before starting, so
    // there is no conversation to pick back up.
    return { ok: false, reason: "not_resumable" };
  }
  if (atConcurrencyLimit()) return { ok: false, reason: "at_capacity" };

  void startSession({
    id: record.id,
    prompt: text,
    cwd: record.cwd,
    permissionMode: record.permissionMode,
    allowedTools: record.allowedTools ?? undefined,
    title: record.title,
    resumeClaudeSessionId: record.claudeSessionId,
  });

  return { ok: true, resumed: true };
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

  // The request may have expired while this response was in flight; settle()
  // reports that so we don't log an approval that never took effect.
  let accepted: boolean;
  if (decision === "allow") {
    accepted = pending.settle({
      behavior: "allow",
      updatedInput: updatedInput ?? pending.originalInput,
    });
  } else {
    accepted = pending.settle({
      behavior: "deny",
      message: "Denied by user via dashboard",
    });
  }
  if (!accepted) return false;

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
  /** Continue a prior Claude conversation rather than starting fresh. */
  resumeClaudeSessionId?: string;
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
    const shortName = toolName.replace(/^mcp__jarvis__/, "");
    const timeoutMs = getSettings().approvalTimeoutMinutes * 60_000;

    const deferred = createDeferredWithTimeout<PermissionResult>(timeoutMs, () => {
      pendingPermissions.delete(requestId);

      const timeoutEvent = appendSessionEvent(params.id, "permission_response", {
        requestId,
        decision: "deny",
        reason: "timeout",
      });
      emitter.emit("event", timeoutEvent);

      // An auto-deny that nobody hears about would just be a quieter version of
      // the problem this timeout exists to solve.
      notify({
        type: "session_failed",
        severity: "warning",
        title: "Approval timed out",
        body: `${params.title ?? "A session"} asked to use ${shortName} and got no answer, so it was denied automatically.`,
        sessionId: params.id,
      });

      // Deny rather than allow: refusing a post is recoverable, sending one isn't.
      // interrupt stops the model retrying alternatives unattended for hours.
      return {
        behavior: "deny",
        message: `No response within the approval window, so this was denied automatically. Stop and leave it for a human.`,
        interrupt: true,
      };
    });

    pendingPermissions.set(requestId, {
      settle: deferred.settle,
      originalInput: toolInput,
    });

    // Surfaced at approval time so a $0.20 post is a decision rather than a
    // surprise on the invoice.
    const estimatedCostUsd = estimateActionCost(shortName, toolInput);

    const event = appendSessionEvent(params.id, "permission_request", {
      requestId,
      toolName,
      input: toolInput,
      toolUseID: options.toolUseID,
      expiresAt: deferred.expiresAt?.toISOString() ?? null,
      estimatedCostUsd,
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
      body: `${params.title ?? "A session"} is waiting on you to approve ${shortName}.`,
      sessionId: params.id,
    });

    return deferred.promise;
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
        allowedTools: [...(params.allowedTools ?? []), ...toolset.autoAllowTools],
        includePartialMessages: true,
        // Loads the working directory's CLAUDE.md automatically. Without this the
        // SDK runs in isolation mode and a session only sees the conventions if a
        // prompt happens to tell it to go and read them.
        settingSources: ["project"],
        canUseTool,
        ...(params.resumeClaudeSessionId
          ? { resume: params.resumeClaudeSessionId }
          : {}),
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

      // Derived from messages already flowing through, so a live progress line
      // costs nothing extra. Only meaningful steps update it, so the last real
      // action stays on screen rather than flickering on every token.
      const activity = describeActivity(message);
      if (activity) {
        updateSession(params.id, { currentActivity: activity });
        globalBus.emit("session_updated", params.id);
      }

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
          // The run's own closing account of what it did.
          summary:
            ("result" in message ? extractSummary(message.result) : null) ?? undefined,
          currentActivity: null,
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
