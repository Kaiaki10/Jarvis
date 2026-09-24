import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, promises as fs } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { appendSessionEvent, getSession, getSettings, listSessionEvents, updateSession } from "../db/repo.js";
import { buildMemoryContext, recordMemoryReflection } from "../db/memoryRepo.js";
import { getAgent } from "../db/agentRepo.js";
import { globalBus } from "../events/globalBus.js";
import { createDeferredWithTimeout } from "./deferredWithTimeout.js";
import { notify } from "../notifications/notifier.js";
import { approveLink } from "../security/approvalToken.js";
import { compactHistory, contextFill } from "./localContext.js";
import type { LocalModelsStatus, SessionEventRecord } from "@jarvis/shared";

interface LocalHandle { abort: AbortController; }
export type LocalFollowUpOutcome =
  | { ok: true; resumed: boolean }
  | { ok: false; reason: "unknown_session" | "not_resumable" | "at_capacity" | "busy" };

const active = new Map<string, LocalHandle>();
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 32768) || 32768;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";

/** Guard against a model deciding to loop its tools forever instead of answering. */
const MAX_TOOL_ROUNDS = 24;
/** Caps so one tool call can't balloon the transcript or the poll. */
const MAX_READ_CHARS = 100_000;
const MAX_COMMAND_OUTPUT = 4_000;
const MAX_GREP_MATCHES = 40;
const MAX_GREP_FILES = 300;
const MAX_LIST_ENTRIES = 200;
const MAX_GLOB_RESULTS = 200;

/**
 * The repo root the local lane is allowed to read: the nearest ancestor of the
 * session's cwd that contains a `.git` directory. Reads are scoped to this
 * tree; anything else is refused without asking. Mutating work goes through
 * `run_command`, which is approval-gated either way.
 */
function repoRootOf(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

function isWithinRoot(abs: string, root: string): boolean {
  const rootSlash = root.endsWith(sep) ? root.toLowerCase() : `${root.toLowerCase()}${sep}`;
  const absLower = abs.toLowerCase();
  return absLower === root.toLowerCase() || absLower.startsWith(rootSlash);
}

/**
 * Resolves a model-supplied path and refuses anything outside the workspace.
 * Non-throwing: out-of-bounds paths come back as a tool-failure so the model
 * can correct itself instead of ending the turn. A leading slash is treated as
 * repo-root-relative — models emit "/apps/..." for a workspace layout all the
 * time, and resolving it drive-relative would escape on Windows.
 */
function resolveScoped(raw: unknown, cwd: string, root: string): { ok: true; path: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim().replace(/^[\\/]+/, "") : "";
  let abs = resolve(cwd, value);
  if (!isWithinRoot(abs, root)) abs = resolve(root, value);
  if (!isWithinRoot(abs, root)) return { ok: false, error: `Path outside the workspace is not allowed: ${abs}` };
  return { ok: true, path: abs };
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

// ---- Ollama tool definitions -------------------------------------------------

interface OllamaFunctionSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const LOCAL_TOOLS: OllamaFunctionSpec[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file inside the workspace and return its contents. Returns the first ~100KB. Use for source files, configs, docs. Use list_dir first if you don't know the exact path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path, absolute or relative to the workspace root." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List the entries of a directory inside the workspace. Directories are marked with a trailing /. Use to discover the project layout.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory path, absolute or relative to the workspace root. Omit for the workspace root itself." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "Find files inside the workspace whose relative paths match a glob. Supports **, *, and ?. Examples: '**/*.ts', 'apps/orchestrator/src/http/*.ts', 'package.json'.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string", description: "Glob pattern." } },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search file contents inside the workspace for a text pattern. Returns matching lines with file paths and line numbers. Good for 'where is X implemented'.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Plain text or regex to search for." },
          include: { type: "string", description: "Optional glob to narrow which files to search, e.g. '*.{ts,tsx}'." },
          caseInsensitive: { type: "boolean", description: "Default false." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the session's working directory (or a given cwd). This can change files or system state, so it is always reviewed by the user first. Use to run builds, tests, or git operations. Note: the transcript is the command's output, do not claim platforms/jarvis tools are available.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run." },
          cwd: { type: "string", description: "Optional working directory; defaults to the session's working directory." },
        },
        required: ["command"],
      },
    },
  },
];

/**
 * The read-only subset offered to room participants. `run_command` is
 * deliberately absent: its approval gate would stall the room's 5-minute
 * turn the same way the Claude approval gate once did (see GAPS.md), so
 * rooms get file reads only and commands stay a chat-lane privilege.
 */
const LOCAL_READONLY_TOOLS: OllamaFunctionSpec[] = LOCAL_TOOLS.filter((tool) =>
  ["read_file", "list_dir", "glob", "grep"].includes(tool.function.name)
);

// ---- Transcript plumbing -----------------------------------------------------

function publish(sessionId: string, event: SessionEventRecord): void {
  globalBus.emit("session_event", event);
}
function emit(sessionId: string, type: SessionEventRecord["type"], payload: unknown): void {
  publish(sessionId, appendSessionEvent(sessionId, type, payload));
}
function userTurn(sessionId: string, text: string): void {
  emit(sessionId, "user", { message: { role: "user", content: text } });
}

/** Text inside a transcript message, whether it's a plain string or ContentBlocks. */
function textOf(message: unknown): string {
  const m = message as { content?: unknown };
  if (typeof m?.content === "string") return m.content;
  if (Array.isArray(m?.content)) {
    return m.content
      .filter((b: { type?: string }) => (b as { type?: string }).type === "text")
      .map((b: { text?: unknown }) => String((b as { text?: unknown }).text ?? ""))
      .join("");
  }
  return "";
}

/**
 * Emits the assistant side of a tool round — a text preamble plus one
 * tool_use block per call — in the same ContentBlock shape the transcript
 * already renders (SessionTranscript.tsx).
 */
function assistantToolTurn(
  sessionId: string,
  model: string,
  text: string,
  calls: OllamaToolCall[]
): void {
  emit(sessionId, "assistant", {
    message: {
      role: "assistant",
      model,
      content: [
        ...(text ? [{ type: "text", text }] : []),
        ...calls.map((call) => ({
          type: "tool_use",
          id: call.id,
          name: call.function?.name ?? "tool",
          input: call.function?.arguments ?? {},
        })),
      ],
    },
  });
}

function assistantTextTurn(sessionId: string, model: string, text: string): void {
  emit(sessionId, "assistant", { message: { role: "assistant", model, content: text } });
}

function history(sessionId: string): Array<{ role: "user" | "assistant"; content: string }> {
  return listSessionEvents(sessionId)
    .filter((e) => e.type === "user" || e.type === "assistant")
    .map((e) => {
      const p = e.payload as { message?: { role?: string } };
      const role: "user" | "assistant" = p.message?.role === "assistant" ? "assistant" : "user";
      return { role, content: textOf((e.payload as { message?: unknown }).message) };
    })
    .filter((m) => m.content.trim());
}

function updateActivity(sessionId: string, activity: string | null): void {
  updateSession(sessionId, { currentActivity: activity });
  globalBus.emit("session_updated", sessionId);
}

/** Live "what is it doing right now" line for the dashboard's working indicator. */
function toolActivity(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "read_file": {
      const target = baseName(String(args.path ?? ""));
      return target ? `Reading ${target}…` : "Reading a file…";
    }
    case "list_dir":
      return `Listing ${String(args.path ?? "/").replace(/\\/g, "/")}…`;
    case "glob":
      return `Globbing ${String(args.pattern ?? "")}…`;
    case "grep":
      return `Searching for ${String(args.pattern ?? "").slice(0, 48)}…`;
    case "run_command":
      return "Awaiting approval to run a command…";
    default:
      return `Using ${name}…`;
  }
}

// ---- Model routing -----------------------------------------------------------

/**
 * Which Ollama model a turn runs on. A session pins its own model at creation
 * (see `startLocalSession`), so follow-ups keep answering with the model the
 * conversation started on even if the env default changes later.
 */
function modelFor(sessionId: string, requested?: string | null): string {
  const explicit = requested?.trim();
  if (explicit) return explicit;
  const session = getSession(sessionId);
  return session?.localModel?.trim() || OLLAMA_MODEL;
}

export async function listLocalModels(): Promise<LocalModelsStatus> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { reachable: false, models: [] };
    const data = await response.json() as { models?: Array<{ name: string; size?: number }> };
    const models = (data.models ?? [])
      .map((model) => ({ name: model.name, sizeBytes: model.size ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { reachable: models.length > 0, models };
  } catch {
    return { reachable: false, models: [] };
  }
}

// ---- Approval gate for mutating tools ---------------------------------------

interface LocalPermissionResult {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
  message?: string;
}
interface PendingLocalPermission {
  settle: (result: LocalPermissionResult) => boolean;
  originalInput: Record<string, unknown>;
}
const pendingLocalPermissions = new Map<string, Map<string, PendingLocalPermission>>();

/**
 * Pauses a local-lane turn for a human decision, reaching the user out of band
 * exactly like the Claude lane does (sessionManager.canUseTool). Read-only
 * tools never reach this gate — only `run_command` does.
 */
async function gateTool(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<LocalPermissionResult> {
  const requestId = randomUUID();
  const timeoutMs = getSettings().approvalTimeoutMinutes * 60_000;
  const deferred = createDeferredWithTimeout<LocalPermissionResult>(timeoutMs, () => {
    pendingLocalPermissions.get(sessionId)?.delete(requestId);
    const timeoutEvent = appendSessionEvent(sessionId, "permission_response", {
      requestId,
      decision: "deny",
      reason: "timeout",
    });
    publish(sessionId, timeoutEvent);
    notify({
      type: "session_failed",
      severity: "warning",
      title: "Approval timed out",
      body: `A local-lane session asked to use ${toolName} and got no answer, so it was denied automatically.`,
      sessionId,
    });
    return { behavior: "deny", message: "No response within the approval window, so this was denied automatically." };
  });
  const session = getSession(sessionId);
  const pending = pendingLocalPermissions.get(sessionId) ?? new Map<string, PendingLocalPermission>();
  pending.set(requestId, { settle: deferred.settle, originalInput: input });
  pendingLocalPermissions.set(sessionId, pending);

  const event = appendSessionEvent(sessionId, "permission_request", {
    requestId,
    toolName,
    input,
    toolUseID: null,
    expiresAt: deferred.expiresAt?.toISOString() ?? null,
  });
  updateSession(sessionId, { status: "waiting_permission" });
  globalBus.emit("session_updated", sessionId);
  publish(sessionId, event);

  notify({
    type: "approval_needed",
    severity: "warning",
    title: "Approval needed",
    body: `${session?.title ?? "A local session"} is waiting on you to approve ${toolName}.`,
    sessionId,
    pushUrl: approveLink(sessionId, requestId, timeoutMs > 0 ? timeoutMs : 24 * 60 * 60_000) ?? undefined,
  });

  return deferred.promise;
}

/**
 * Settles a pending permission for a local-lane session. Mirrors
 * sessionManager.resolvePermission so the dashboard's existing
 * permission-response endpoint can serve both lanes.
 */
export function resolveLocalPermission(
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny",
  updatedInput?: Record<string, unknown>
): boolean {
  const pending = pendingLocalPermissions.get(sessionId)?.get(requestId);
  if (!pending) return false;
  pendingLocalPermissions.get(sessionId)?.delete(requestId);
  if (pendingLocalPermissions.get(sessionId)?.size === 0) pendingLocalPermissions.delete(sessionId);

  let accepted: boolean;
  if (decision === "allow") {
    accepted = pending.settle({
      behavior: "allow",
      updatedInput: updatedInput ?? pending.originalInput,
    });
  } else {
    accepted = pending.settle({ behavior: "deny", message: "Denied by user via dashboard" });
  }
  if (!accepted) return false;

  const event = appendSessionEvent(sessionId, "permission_response", { requestId, decision });
  publish(sessionId, event);
  updateSession(sessionId, { status: "running" });
  globalBus.emit("session_updated", sessionId);
  return true;
}

export function abortPendingLocalPermissions(sessionId: string): void {
  const pending = pendingLocalPermissions.get(sessionId);
  if (!pending) return;
  for (const entry of pending.values()) {
    entry.settle({ behavior: "deny", message: "Interrupted before the approval was answered." });
  }
  pendingLocalPermissions.delete(sessionId);
}

// ---- Tool implementations ----------------------------------------------------

function normalizeArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let out = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        out += "[^]*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

async function walkFiles(root: string, skipDirs = new Set(["node_modules", ".git", ".next", "dist", "build", ".venv", "coverage"])): Promise<string[]> {
  const found: string[] = [];
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop()!;
    const abs = rel ? join(root, rel) : root;
    let entries;
    try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        stack.push(rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        found.push(rel ? `${rel}/${entry.name}` : entry.name);
        if (found.length > MAX_GREP_FILES) return found;
      }
    }
  }
  return found;
}

async function executeTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  root: string,
  controller: AbortController
): Promise<string> {
  const fail = (message: string) => `tool ${name} error: ${message}`;
  switch (name) {
    case "list_dir": {
      const scoped = resolveScoped(args.path ?? "", cwd, root);
      if (!scoped.ok) return fail(scoped.error);
      let entries;
      try {
        entries = await fs.readdir(scoped.path, { withFileTypes: true });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      const rows = entries
        .slice(0, MAX_LIST_ENTRIES)
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      return rows.join("\n") || "(empty directory)";
    }
    case "read_file": {
      const scoped = resolveScoped(args.path ?? "", cwd, root);
      if (!scoped.ok) return fail(scoped.error);
      const file = scoped.path;
      let stat;
      try { stat = await fs.stat(file); } catch { return fail("no such file"); }
      if (stat.isDirectory()) return fail("path is a directory; use list_dir");
      let content;
      try {
        content = await fs.readFile(file, "utf8");
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      const truncated = content.length > MAX_READ_CHARS;
      return `${truncated ? content.slice(0, MAX_READ_CHARS) + "\n… (truncated)" : content}`;
    }
    case "glob": {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return fail("pattern is required");
      const regex = globToRegex(pattern);
      const matches: string[] = [];
      for (const rel of await walkFiles(root)) {
        if (regex.test(rel)) {
          matches.push(rel);
          if (matches.length >= MAX_GLOB_RESULTS) break;
        }
      }
      return matches.join("\n") || "(no files matched)";
    }
    case "grep": {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return fail("pattern is required");
      let needle: RegExp;
      try {
        needle = new RegExp(pattern, args.caseInsensitive ? "ig" : "g");
      } catch {
        return fail(`invalid pattern: ${pattern}`);
      }
      const includeRegex = args.include ? globToRegex(String(args.include)) : null;
      const hits: string[] = [];
      for (const rel of await walkFiles(root)) {
        if (includeRegex && !includeRegex.test(rel)) continue;
        let text;
        try { text = await fs.readFile(join(root, rel), "utf8"); } catch { continue; }
        if (!text.includes(pattern)) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < MAX_GREP_MATCHES + 20; i++) {
          if (needle.test(lines[i]) && hits.length < MAX_GREP_MATCHES) {
            hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
          }
        }
        if (hits.length >= MAX_GREP_MATCHES + 20) break;
      }
      const shown = hits.slice(0, MAX_GREP_MATCHES);
      return `${shown.join("\n") || "(no matches)"}${hits.length > MAX_GREP_MATCHES ? `\n… (${hits.length - MAX_GREP_MATCHES} more)` : ""}`;
    }
    case "run_command": {
      // Mirrors the Claude lane's autoApproveLocalTools: sessions the scheduler
      // (or an explicit "always allow local work") flag can skip the gate.
      const autoApprove = getSession(sessionId)?.autoApproveLocalTools === true;
      const decision = autoApprove
        ? { behavior: "allow" as const, updatedInput: args }
        : await gateTool(sessionId, name, args);
      if (decision.behavior === "deny") {
        return `run_command was denied by the user${decision.message ? `: ${decision.message}` : ""}. Do NOT retry it unless asked.`;
      }
      const input = (decision.updatedInput ?? args) as { command?: string; cwd?: string };
      const command = String(input.command ?? "").trim();
      if (!command) return fail("command is required");
      const scopedCwd = input.cwd ? resolveScoped(input.cwd, cwd, root) : null;
      const runCwd = scopedCwd?.ok ? scopedCwd.path : cwd;
      updateActivity(sessionId, `Running ${command.slice(0, 80)}…`);
      try {
        const { stdout, stderr } = await promisify(exec)(command, {
          cwd: runCwd,
          timeout: 180_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          encoding: "utf8",
          signal: controller.signal,
        });
        let out = `${stderr ? `stderr:\n${stderr.trim()}\n\n` : ""}${stdout.trim()}` || "(no output)";
        if (out.length > MAX_COMMAND_OUTPUT) out = `${out.slice(0, MAX_COMMAND_OUTPUT)}\n… (truncated)`;
        return out;
      } catch (err) {
        const e = err as { killed?: boolean; code?: string | number; stdout?: string; stderr?: string };
        return fail(
          `exited ${e?.code ?? "with error"}${e?.stdout ? `\nstdout:\n${String(e.stdout).trim()}` : ""}${e?.stderr ? `\nstderr:\n${String(e.stderr).trim()}` : ""}`
        );
      }
    }
    default:
      return fail(`unknown tool ${name}`);
  }
}

// ---- The turn loop -----------------------------------------------------------

interface OllamaToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface TurnChatUsage {
  promptTokens: number;
  completionTokens: number;
}

async function requestChat(
  model: string,
  messages: unknown[],
  controller: AbortController,
  withTools: boolean,
  onDelta?: (text: string) => void,
  readOnly?: boolean
): Promise<{ content: string; reasoning: string; calls: OllamaToolCall[]; doneReason: string; usage: TurnChatUsage }> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      ...(withTools ? { tools: readOnly ? LOCAL_READONLY_TOOLS : LOCAL_TOOLS } : {}),
      stream: true,
      num_ctx: OLLAMA_NUM_CTX,
    }),
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);

  // Ollama streams NDJSON — one object per line. Final chunk carries the
  // tool calls (on a tool round) plus the accumulated eval counts.
  if (!response.body) throw new Error("Ollama returned no streaming body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let calls: OllamaToolCall[] = [];
  let doneReason = "unknown";
  let promptEvalCount = 0;
  let evalCount = 0 - 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let chunk: {
        message?: { content?: string | null; reasoning_content?: string | null; thinking?: string | null; tool_calls?: OllamaToolCall[] };
        done?: boolean;
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      try {
        chunk = JSON.parse(trimmed) as typeof chunk;
      } catch {
        continue;
      }
      const piece = chunk.message?.content ?? "";
      if (piece) {
        content += piece;
        onDelta?.(piece);
      }
      // Thinking models stream their chain-of-thought as `thinking` (older
      // Ollama) or `reasoning_content` (newer) — neither is the answer, but
      // dropping both makes a thinking turn look dead until the 5-minute
      // timeout kills it. Kept as fallback material, never streamed as reply.
      reasoning += chunk.message?.reasoning_content ?? chunk.message?.thinking ?? "";
      if (chunk.message?.tool_calls?.length) calls = chunk.message.tool_calls;
      if (chunk.done) {
        doneReason = chunk.done_reason ?? "unknown";
        promptEvalCount = chunk.prompt_eval_count ?? 0;
        evalCount = chunk.eval_count ?? 0;
      }
    }
  }
  return {
    content: content.trim(),
    reasoning: reasoning.trim(),
    calls,
    doneReason,
    usage: {
      promptTokens: promptEvalCount,
      completionTokens: evalCount,
    },
  };
}

/** Models that can't do function calling reject the tools field — that's fine, answer without tools. */
function toolUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /tool[s]?.*?(not supported|not enabled|unsupported)|function calling not supported|does not support tool/i.test(message);
}

async function runTurn(params: { id: string; prompt: string; cwd: string; agentId?: string | null; localModel?: string | null; readOnly?: boolean }): Promise<void> {
  const controller = new AbortController();
  active.set(params.id, { abort: controller });
  const startedAt = Date.now();
  const priorHistory = history(params.id);
  const model = modelFor(params.id, params.localModel);
  userTurn(params.id, params.prompt);
  updateSession(params.id, { status: "running", currentActivity: `Running local LLM · ${model}…`, localModel: model });
  globalBus.emit("session_updated", params.id);

  try {
    const session = getSession(params.id);
    const agent = params.agentId ? getAgent(params.agentId) : undefined;
    const agentContext = agent?.systemPrompt?.trim() || getSettings().businessContext;
    const memory = buildMemoryContext(40, params.agentId ?? null);
    const root = repoRootOf(params.cwd);
    const system = [
      "You are Jarvis, a local AI assistant running on the user's computer.",
      "You can genuinely inspect this workspace with your local tools (list_dir, glob, grep, read_file) and run shell commands (run_command, always user-approved). You do NOT have Jarvis's outbound platform tools (no posting, messaging, or spending). Be truthful: when you have not checked a file, say so; do not claim to have explored something you have not.",
      params.readOnly ? "You are speaking in a multi-agent room: inspect files freely, but you have no shell — do not ask to run commands, answer from what you can read." : "",
      session?.title ? `Conversation: ${session.title}` : "",
      agentContext?.trim() ?? "",
      memory ? `Durable memory:\n${memory}` : "",
    ].filter(Boolean).join("\n\n");

    const fill = contextFill(priorHistory, OLLAMA_NUM_CTX);
    const replayedHistory = fill > 0.75
      ? compactHistory(
          priorHistory.map((m, i) => ({ role: m.role, content: m.content, seq: i })),
          { numCtx: OLLAMA_NUM_CTX, window: 40, minKeep: 12 }
        ).map(({ role, content }) => ({ role, content }))
      : priorHistory;

    const messages: unknown[] = [
      { role: "system", content: system },
      ...replayedHistory.slice(-40),
      { role: "user", content: params.prompt },
    ];

    if (fill > 0.75 && replayedHistory.length < priorHistory.length) {
      emit(params.id, "system", {
        subtype: "context_compressed",
        message: `Context was compacted: ${priorHistory.length} prior turns → ${replayedHistory.length} (context ${Math.round(fill * 100)}% full).`,
      });
    }

    let finalText = "";
    let reasoningFallback = "";
    let lastDoneReason = "unknown";
    let emptyReplies = 0;
    let toolsEnabled = true;
    let maxPromptTokens = 0;
    let completionTokens = 0;
    let sawUsage = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let resp;
      try {
        resp = await requestChat(model, messages, controller, toolsEnabled, (piece) => {
          // Forward each Ollama content delta to the browser SSE exactly like the
          // Claude lane does, so the transcript's live line updates token-by-token
          // instead of only appearing when the whole turn lands.
          emit(params.id, "stream_event", {
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: piece },
            },
          });
        }, params.readOnly);
      } catch (err) {
        if (toolsEnabled && toolUnsupportedError(err)) {
          // Nothing tool-shaped has been pushed to messages (the call failed
          // before any tool ran), so it's safe to restart the round without tools.
          toolsEnabled = false;
          round--;
          continue;
        }
        throw err;
      }

      if (resp.usage.promptTokens > 0) {
        sawUsage = true;
        maxPromptTokens = Math.max(maxPromptTokens, resp.usage.promptTokens);
        completionTokens += resp.usage.completionTokens;
      }

      if (resp.calls.length) {
        emptyReplies = 0;
        assistantToolTurn(params.id, model, resp.content, resp.calls);
        const calls = resp.calls.map((call) => ({ ...call, function: { ...call.function, arguments: normalizeArgs(call.function?.arguments) } }));
        messages.push({ role: "assistant", content: resp.content, tool_calls: calls });
        for (const call of calls) {
          const name = call.function?.name ?? "tool";
          const args = call.function?.arguments ?? {};
          updateActivity(params.id, toolActivity(name, args));
          const result = await executeTool(params.id, name, args, params.cwd, root, controller);
          messages.push({ role: "tool", content: result });
        }
        updateActivity(params.id, `Local LLM · ${model}…`);
        continue;
      }

      if (resp.content) {
        finalText = resp.content;
        reasoningFallback = resp.reasoning;
        lastDoneReason = resp.doneReason;
        break;
      }

      // Empty final answer — the Qwen3 thinking quirk. Nudge and retry, as before.
      if (resp.reasoning) reasoningFallback = resp.reasoning;
      lastDoneReason = resp.doneReason;
      emptyReplies++;
      if (emptyReplies >= 3) {
        if (reasoningFallback) {
          finalText = `(The model produced only internal reasoning — it never formed a final answer.)\n\n${reasoningFallback}`;
        }
        break;
      }
      messages.push({
        role: "user",
        content: "(You ended your previous reply without a visible answer. Reply now, directly, with your actual answer.)",
      });
    }

    if (!finalText) throw new Error(`Ollama returned an empty response (done_reason: ${lastDoneReason}).`);

    const usage = sawUsage
      ? {
          promptTokens: maxPromptTokens,
          completionTokens,
          contextTokenLimit: OLLAMA_NUM_CTX,
          contextPercent: Math.min(100, Math.round(((maxPromptTokens + completionTokens) / OLLAMA_NUM_CTX) * 100)),
        }
      : undefined;

    assistantTextTurn(params.id, model, finalText);
    updateSession(params.id, {
      status: "idle",
      turns: (session?.turns ?? 0) + 1,
      summary: finalText.replace(/\s+/g, " ").slice(0, 280),
      currentActivity: null,
      costUsd: 0,
    });
    emit(params.id, "result", {
      is_error: false,
      duration_ms: Date.now() - startedAt,
      result: finalText,
      model,
      ...(usage ? { usage } : {}),
    });
    recordMemoryReflection({ sessionId: params.id, status: "reviewed", memoriesAdded: 0, memoriesConfirmed: 0 });
    globalBus.emit("memories_changed");
  } catch (error) {
    const interrupted = controller.signal.aborted;
    const detail = interrupted ? "The local LLM turn was interrupted." : error instanceof Error ? error.message : String(error);
    updateSession(params.id, { status: interrupted ? "interrupted" : "error", errorMessage: detail, currentActivity: null, costUsd: 0 });
    emit(params.id, "result", { is_error: true, duration_ms: Date.now() - startedAt, errors: [detail], model });
  } finally {
    abortPendingLocalPermissions(params.id);
    active.delete(params.id);
    globalBus.emit("session_updated", params.id);
  }
}

export function activeLocalSessionCount(): number { return active.size; }
export function startLocalSession(params: { id: string; prompt: string; cwd: string; title?: string; agentId?: string | null; localModel?: string | null; readOnly?: boolean }): void {
  void runTurn(params);
}
export function sendLocalFollowUp(sessionId: string, text: string, localModel?: string | null, readOnly?: boolean): LocalFollowUpOutcome {
  if (active.has(sessionId)) return { ok: false, reason: "busy" };
  const session = getSession(sessionId);
  if (!session || session.model !== "local") return { ok: false, reason: "not_resumable" };
  void runTurn({ id: session.id, prompt: text, cwd: session.cwd, agentId: session.agentId, localModel, readOnly });
  return { ok: true, resumed: true };
}
export function interruptLocalSession(sessionId: string): boolean {
  const handle = active.get(sessionId);
  if (!handle) return false;
  handle.abort.abort();
  return true;
}