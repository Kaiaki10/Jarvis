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
import { buildMemoryContext, recordMemoryReflection } from "../db/memoryRepo.js";
import { getAgent } from "../db/agentRepo.js";
import { buildMemoryToolset } from "../memory/memoryTools.js";
import { notify } from "../notifications/notifier.js";
import {
  collectArtifactsFromMessage,
  collectArtifactsFromResult,
  reconcileMissionTurn,
} from "../missions/missionReconciler.js";
import { reconcileCampaignGeneration } from "../campaigns/contentGeneration.js";
import { reconcileContentPublication } from "../campaigns/publicationReconciler.js";
import { reconcileCustomerReplyDraft } from "../customers/replyDraft.js";

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

/**
 * Session-scoped emitters serve direct consumers, while the global event keeps
 * an already-open browser stream alive when an idle session is reaped and later
 * revived with a brand-new handle.
 */
function publishSessionEvent(sessionId: string, event: SessionEventRecord): void {
  sessions.get(sessionId)?.emitter.emit("event", event);
  globalBus.emit("session_event", event);
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
 * Writes what the person actually typed into the transcript.
 *
 * The SDK streams back its own messages and echoes tool results as "user"
 * events, but the prompt text itself only ever travels inbound — so without
 * this the stored conversation is one-sided.
 */
function recordUserTurn(sessionId: string, text: string): void {
  const event = appendSessionEvent(sessionId, "user", {
    message: { role: "user", content: text },
  });
  publishSessionEvent(sessionId, event);
}

/**
 * Continues a conversation, transparently reviving it if the session was reaped.
 *
 * Reaping frees the Claude Code subprocess after 30 minutes idle, which used to
 * make follow-ups fail outright. The SDK can resume from the stored
 * claudeSessionId, so from the caller's side the conversation just continues —
 * the transcript keeps appending to the same session row either way.
 */
export function sendFollowUp(
  sessionId: string,
  text: string,
  options: { memoryWritable?: boolean } = {}
): FollowUpOutcome {
  const handle = sessions.get(sessionId);

  if (handle) {
    if (!handle.working && atConcurrencyLimit()) {
      return { ok: false, reason: "at_capacity" };
    }
    handle.working = true;
    handle.lastActivityAt = Date.now();
    handle.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: handle.claudeSessionId ?? "",
    });
    // The SDK echoes back tool results as "user" messages but never the text a
    // person typed, so record it here or the transcript shows only one side.
    recordUserTurn(sessionId, text);
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
    memoryWritable: options.memoryWritable,
    // A revived session must come back as the same agent, or the follow-up
    // would answer with a different persona than the thread it is continuing.
    agentId: record.agentId,
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
  publishSessionEvent(sessionId, event);
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
  /** Lets scheduled runs arrange a bounded retry after a failed turn. */
  onTurnFinished?: (ok: boolean) => void;
  /** Runs without project instructions or built-in tools for focused text work. */
  isolated?: boolean;
  /** Whose persona and memory this run carries. */
  agentId?: string | null;
  /** Legacy override retained for resumed records; all non-isolated runs now reflect memory. */
  memoryWritable?: boolean;
}

const SAFE_PERMISSION_MODES = new Set(["default", "acceptEdits", "plan", "dontAsk"]);

function safePermissionMode(mode: string): PermissionMode {
  return (SAFE_PERMISSION_MODES.has(mode) ? mode : "default") as PermissionMode;
}

function safeCallerAllowedTools(tools: string[] | undefined): string[] {
  // Jarvis MCP tools are controlled by this service. In particular, callers must
  // never be able to pre-approve an outbound action and skip canUseTool.
  return (tools ?? []).filter(
    (name) => !name.startsWith("mcp__jarvis__") && !name.startsWith("mcp__memory__")
  );
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
      publishSessionEvent(params.id, timeoutEvent);

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

    const event = appendSessionEvent(params.id, "permission_request", {
      requestId,
      toolName,
      input: toolInput,
      toolUseID: options.toolUseID,
      expiresAt: deferred.expiresAt?.toISOString() ?? null,
    });
    updateSession(params.id, { status: "waiting_permission" });
    globalBus.emit("session_updated", params.id);
    publishSessionEvent(params.id, event);

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
  recordUserTurn(params.id, params.prompt);

  updateSession(params.id, { status: "running" });
  globalBus.emit("session_updated", params.id);

  // An agent's own persona replaces the single global business context. Runs
  // with no agent (and pre-v2 rows) keep using the global setting, so nothing
  // that already worked loses its instructions.
  const agent = params.agentId ? getAgent(params.agentId) : undefined;
  const businessContext = agent?.systemPrompt?.trim()
    ? agent.systemPrompt
    : getSettings().businessContext;
  const platformToolset = params.isolated
    ? { capabilitySummary: "", autoAllowTools: [] }
    : buildPlatformToolset(params.id);
  let memoriesAddedThisTurn = 0;
  let memoriesConfirmedThisTurn = 0;
  const memoryToolset = !params.isolated
    ? buildMemoryToolset(params.id, (created) => {
        if (created) memoriesAddedThisTurn += 1;
        else memoriesConfirmedThisTurn += 1;
      }, params.agentId)
    : null;
  const memoryContext = params.isolated ? "" : buildMemoryContext(40, params.agentId);
  const systemPromptAppend = [
    businessContext.trim(),
    memoryContext,
    platformToolset.capabilitySummary,
    memoryToolset?.capabilitySummary ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const mcpServers = {
    ...("mcpServers" in platformToolset ? platformToolset.mcpServers : undefined),
    ...(memoryToolset?.mcpServers ?? {}),
  };
  const autoAllowTools = [
    ...platformToolset.autoAllowTools,
    ...(memoryToolset?.autoAllowTools ?? []),
  ];
  let initialTurnReported = false;
  const missionArtifacts = new Set<string>();
  const reportInitialTurn = (ok: boolean) => {
    if (initialTurnReported) return;
    initialTurnReported = true;
    params.onTurnFinished?.(ok);
  };

  try {
    const q = query({
      prompt: input,
      options: {
        cwd: params.cwd,
        permissionMode: safePermissionMode(params.permissionMode),
        allowedTools: [...safeCallerAllowedTools(params.allowedTools), ...autoAllowTools],
        includePartialMessages: true,
        // Loads the working directory's CLAUDE.md automatically. Without this the
        // SDK runs in isolation mode and a session only sees the conventions if a
        // prompt happens to tell it to go and read them.
        settingSources: params.isolated ? [] : ["project"],
        ...(params.isolated ? { tools: [] as string[] } : {}),
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
        ...(!params.isolated && Object.keys(mcpServers).length
          ? { mcpServers }
          : {}),
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
      publishSessionEvent(params.id, event);

      for (const artifact of collectArtifactsFromMessage(message, params.cwd)) {
        missionArtifacts.add(artifact);
      }

      // Derived from messages already flowing through, so a live progress line
      // costs nothing extra. Only meaningful steps update it, so the last real
      // action stays on screen rather than flickering on every token.
      const activity = describeActivity(message);
      if (activity) {
        updateSession(params.id, { currentActivity: activity });
        globalBus.emit("session_updated", params.id);
      }

      if (message.type === "result") {
        reportInitialTurn(!message.is_error);
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
        const result = "result" in message ? message.result : null;
        for (const artifact of collectArtifactsFromResult(result, params.cwd)) {
          missionArtifacts.add(artifact);
        }
        try {
          const missionChanged = reconcileMissionTurn({
            sessionId: params.id,
            result,
            ok: !message.is_error,
            artifactPaths: missionArtifacts,
          });
          if (missionChanged) globalBus.emit("missions_changed");
        } catch (err) {
          // Mission bookkeeping is valuable, but a bookkeeping defect must not
          // rewrite an otherwise successful agent run as failed.
          console.error("[missions] could not reconcile completed turn:", err);
        } finally {
          missionArtifacts.clear();
        }
        try {
          if (reconcileCampaignGeneration({ sessionId: params.id, result, ok: !message.is_error })) {
            globalBus.emit("campaigns_changed");
          }
        } catch (err) {
          console.error("[campaigns] could not reconcile generated content:", err);
        }
        try {
          if (reconcileContentPublication({ sessionId: params.id, ok: !message.is_error })) {
            globalBus.emit("campaigns_changed");
          }
        } catch (err) {
          console.error("[campaigns] could not reconcile publication:", err);
        }
        try {
          if (await reconcileCustomerReplyDraft({ sessionId: params.id, result, ok: !message.is_error })) {
            globalBus.emit("customers_changed");
          }
        } catch (err) {
          console.error("[customers] could not reconcile reply draft:", err);
        }
        try {
          recordMemoryReflection({
            sessionId: params.id,
            status: params.isolated ? "skipped" : message.is_error ? "failed" : "reviewed",
            memoriesAdded: memoriesAddedThisTurn,
            memoriesConfirmed: memoriesConfirmedThisTurn,
          });
          memoriesAddedThisTurn = 0;
          memoriesConfirmedThisTurn = 0;
          globalBus.emit("memories_changed");
        } catch (err) {
          console.error("[memory] could not record automatic reflection:", err);
        }
      } else {
        updateSession(params.id, {
          status: "running",
          claudeSessionId: handle.claudeSessionId ?? undefined,
        });
      }
      globalBus.emit("session_updated", params.id);
    }
  } catch (err) {
    reportInitialTurn(false);
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
    try {
      recordMemoryReflection({
        sessionId: params.id,
        status: params.isolated ? "skipped" : "failed",
        memoriesAdded: memoriesAddedThisTurn,
        memoriesConfirmed: memoriesConfirmedThisTurn,
      });
      globalBus.emit("memories_changed");
    } catch (reflectionError) {
      console.error("[memory] could not record failed reflection:", reflectionError);
    }
    try {
      if (reconcileCampaignGeneration({ sessionId: params.id, result: null, ok: false })) {
        globalBus.emit("campaigns_changed");
      }
    } catch (reconcileError) {
      console.error("[campaigns] could not record failed generation:", reconcileError);
    }
    try {
      if (reconcileContentPublication({ sessionId: params.id, ok: false })) {
        globalBus.emit("campaigns_changed");
      }
    } catch (reconcileError) {
      console.error("[campaigns] could not record failed publication:", reconcileError);
    }
    try {
      if (await reconcileCustomerReplyDraft({ sessionId: params.id, result: null, ok: false })) {
        globalBus.emit("customers_changed");
      }
    } catch (reconcileError) {
      console.error("[customers] could not record failed reply draft:", reconcileError);
    }
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
