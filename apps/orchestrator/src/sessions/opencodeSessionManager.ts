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
import { OPENCODE_MODELS, type OpenCodeModelsStatus, type SessionEventRecord } from "@jarvis/shared";

/**
 * The OpenCode lane: Jarvis chat answered by OpenCode Inference models
 * (Muse Spark, MiMo, Ling) over the OpenAI-compatible Chat Completions API.
 *
 * Deliberately mirrors `localSessionManager.ts` — same workspace tools, same
 * approval gate for `run_command`, same transcript event shapes — so the
 * dashboard renders every lane identically. Only the request layer differs:
 * SSE `data:` chunks instead of Ollama NDJSON, and OpenAI `tool_calls`
 * instead of Ollama's.
 *
 * Auth: free Inference models refuse unauthenticated calls from outside
 * OpenCode itself (`FreeTierError`, verified live). A Console
 * service-account key in `OPENCODE_API_KEY` is sent as a Bearer token when
 * set; without it the turn fails closed with instructions, not a guess.
 */

interface OpencodeHandle { abort: AbortController; }
export type OpencodeFollowUpOutcome =
  | { ok: true; resumed: boolean }
  | { ok: false; reason: "unknown_session" | "not_resumable" | "at_capacity" | "busy" };

const active = new Map<string, OpencodeHandle>();
const OPENCODE_API_URL = process.env.OPENCODE_API_URL ?? "https://opencode.ai/inference/openai/v1/chat/completions";
const OPENCODE_MODELS_URL = process.env.OPENCODE_MODELS_URL ?? "https://opencode.ai/inference/v1/models";
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY ?? "";
const OPENCODE_NUM_CTX = Number(process.env.OPENCODE_NUM_CTX ?? 32768) || 32768;
const OPENCODE_MODEL = process.env.OPENCODE_MODEL ?? "muse-spark-1.3-contributor-free";

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
 * The repo root the OpenCode lane is allowed to read: the nearest ancestor of
 * the session's cwd that contains a `.git` directory. Same scoping as the
 * local lane — reads stay in this tree, mutations go through `run_command`.
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
 * can correct itself instead of ending the turn.
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

// ---- OpenAI-style tool definitions -------------------------------------------

interface ChatFunctionSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const OPENCODE_TOOLS: ChatFunctionSpec[] = [
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
      description: "Run a shell command in the session's working directory (or a given cwd). This can change files or system state, so it is always reviewed by the user first. Use to run builds, tests, or git operations.",
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
const OPENCODE_READONLY_TOOLS: ChatFunctionSpec[] = OPENCODE_TOOLS.filter((tool) =>
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
  calls: OpencodeToolCall[]
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
 * Which Inference model a turn runs on. A session pins its own model at
 * creation (see `startOpencodeSession`), so follow-ups keep answering with
 * the model the conversation started on even if the env default changes
 * later. Unknown ids pass through untouched — the API names the bad id in
 * its error, which beats silently substituting a different model.
 */
function modelFor(sessionId: string, requested?: string | null): string {
  const explicit = requested?.trim();
  if (explicit) return explicit;
  const session = getSession(sessionId);
  return session?.opencodeModel?.trim() || OPENCODE_MODEL;
}

/**
 * Lists the three supported Inference models, marked reachable when the
 * models endpoint answers. Reachable means the service is up — it says
 * nothing about whether calls will be accepted without `OPENCODE_API_KEY`.
 */
export async function listOpencodeModels(): Promise<OpenCodeModelsStatus> {
  const labels = new Map(OPENCODE_MODELS.map((m) => [m.value, m.label]));
  try {
    const response = await fetch(OPENCODE_MODELS_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { reachable: false, models: [] };
    const data = await response.json() as { data?: Array<{ id: string }> };
    const ids = new Set((data.data ?? []).map((m) => m.id));
    const models = [...labels.entries()]
      .filter(([id]) => ids.has(id))
      .map(([id, label]) => ({ id, label }));
    return { reachable: true, models };
  } catch {
    return { reachable: false, models: [] };
  }
}

// ---- Approval gate for mutating tools ---------------------------------------

interface OpencodePermissionResult {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
  message?: string;
}
interface PendingOpencodePermission {
  settle: (result: OpencodePermissionResult) => boolean;
  originalInput: Record<string, unknown>;
}
const pendingOpencodePermissions = new Map<string, Map<string, PendingOpencodePermission>>();

/**
 * Pauses an OpenCode-lane turn for a human decision, reaching the user out of
 * band exactly like the Claude and local lanes do. Read-only tools never
 * reach this gate — only `run_command` does.
 */
async function gateTool(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<OpencodePermissionResult> {
  const requestId = randomUUID();
  const timeoutMs = getSettings().approvalTimeoutMinutes * 60_000;
  const deferred = createDeferredWithTimeout<OpencodePermissionResult>(timeoutMs, () => {
    pendingOpencodePermissions.get(sessionId)?.delete(requestId);
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
      body: `An OpenCode session asked to use ${toolName} and got no answer, so it was denied automatically.`,
      sessionId,
    });
    return { behavior: "deny", message: "No response within the approval window, so this was denied automatically." };
  });
  const session = getSession(sessionId);
  const pending = pendingOpencodePermissions.get(sessionId) ?? new Map<string, PendingOpencodePermission>();
  pending.set(requestId, { settle: deferred.settle, originalInput: input });
  pendingOpencodePermissions.set(sessionId, pending);

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
    body: `${session?.title ?? "An OpenCode session"} is waiting on you to approve ${toolName}.`,
    sessionId,
    pushUrl: approveLink(sessionId, requestId, timeoutMs > 0 ? timeoutMs : 24 * 60 * 60_000) ?? undefined,
  });

  return deferred.promise;
}

/**
 * Settles a pending permission for an OpenCode-lane session. Mirrors
 * sessionManager.resolvePermission so the dashboard's existing
 * permission-response endpoint can serve every lane.
 */
export function resolveOpencodePermission(
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny",
  updatedInput?: Record<string, unknown>
): boolean {
  const pending = pendingOpencodePermissions.get(sessionId)?.get(requestId);
  if (!pending) return false;
  pendingOpencodePermissions.get(sessionId)?.delete(requestId);
  if (pendingOpencodePermissions.get(sessionId)?.size === 0) pendingOpencodePermissions.delete(sessionId);

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

export function abortPendingOpencodePermissions(sessionId: string): void {
  const pending = pendingOpencodePermissions.get(sessionId);
  if (!pending) return;
  for (const entry of pending.values()) {
    entry.settle({ behavior: "deny", message: "Interrupted before the approval was answered." });
  }
  pendingOpencodePermissions.delete(sessionId);
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

interface OpencodeToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface TurnChatUsage {
  promptTokens: number;
  completionTokens: number;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OPENCODE_API_KEY) headers.Authorization = `Bearer ${OPENCODE_API_KEY}`;
  return headers;
}

/** Refusals that mean "call me from inside OpenCode or with a Console key", not a bug. */
function accessDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /FreeTierError|free tier|HTTP 401|HTTP 403|unauthorized|forbidden/i.test(message);
}

function accessDeniedText(status: number, body: string): string {
  return `OpenCode refused the request (HTTP ${status}): ${body.slice(0, 300) || "no detail"}. ` +
    `Free Inference models only answer inside OpenCode itself unless called with a Console service-account key — ` +
    `set OPENCODE_API_KEY on the orchestrator and retry.`;
}

async function requestChat(
  model: string,
  messages: unknown[],
  controller: AbortController,
  withTools: boolean,
  onDelta?: (text: string) => void,
  readOnly?: boolean
): Promise<{ content: string; calls: OpencodeToolCall[]; finishReason: string; usage: TurnChatUsage }> {
  const response = await fetch(OPENCODE_API_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model,
      messages,
      ...(withTools ? { tools: readOnly ? OPENCODE_READONLY_TOOLS : OPENCODE_TOOLS } : {}),
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: controller.signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403 || /FreeTierError/i.test(body)) {
      throw new Error(accessDeniedText(response.status, body));
    }
    throw new Error(`OpenCode returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  // Chat Completions streams SSE — one `data:` JSON object per line, ending
  // with `data: [DONE]`. Text arrives as delta.content fragments; tool calls
  // arrive as delta.tool_calls fragments keyed by index, whose
  // function.arguments strings must be concatenated before parsing.
  if (!response.body) throw new Error("OpenCode returned no streaming body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason = "unknown";
  const callFragments = new Map<number, { id: string; name: string; args: string }>();
  let promptTokens = 0;
  let completionTokens = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let chunk: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
          };
          finish_reason?: string | null;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        chunk = JSON.parse(payload) as typeof chunk;
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        onDelta?.(delta.content);
      }
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const slot = callFragments.get(index) ?? { id: "", name: "", args: "" };
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name = call.function.name;
        if (call.function?.arguments) slot.args += call.function.arguments;
        callFragments.set(index, slot);
      }
      if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
    }
  }
  const calls: OpencodeToolCall[] = [...callFragments.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, slot]) => ({
      id: slot.id || randomUUID(),
      function: { name: slot.name, arguments: normalizeArgs(slot.args) },
    }))
    .filter((call) => call.function?.name);
  return {
    content: content.trim(),
    calls,
    finishReason,
    usage: { promptTokens, completionTokens },
  };
}

/** Models without function calling reject the tools field — that's fine, answer without tools. */
function toolUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /tool[s]?.*?(not supported|not enabled|unsupported)|function calling|unsupported_function|does not support/i.test(message);
}

async function runTurn(params: { id: string; prompt: string; cwd: string; agentId?: string | null; opencodeModel?: string | null; readOnly?: boolean }): Promise<void> {
  const controller = new AbortController();
  active.set(params.id, { abort: controller });
  const startedAt = Date.now();
  const priorHistory = history(params.id);
  const model = modelFor(params.id, params.opencodeModel);
  userTurn(params.id, params.prompt);
  updateSession(params.id, { status: "running", currentActivity: `Running OpenCode · ${model}…`, opencodeModel: model });
  globalBus.emit("session_updated", params.id);

  try {
    const session = getSession(params.id);
    const agent = params.agentId ? getAgent(params.agentId) : undefined;
    const agentContext = agent?.systemPrompt?.trim() || getSettings().businessContext;
    const memory = buildMemoryContext(40, params.agentId ?? null);
    const root = repoRootOf(params.cwd);
    const system = [
      "You are Jarvis, an AI assistant running on the user's computer, answering through an OpenCode-hosted model.",
      "You can genuinely inspect this workspace with your tools (list_dir, glob, grep, read_file) and run shell commands (run_command, always user-approved). You do NOT have Jarvis's outbound platform tools (no posting, messaging, or spending). Be truthful: when you have not checked a file, say so; do not claim to have explored something you have not.",
      params.readOnly ? "You are speaking in a multi-agent room: inspect files freely, but you have no shell — do not ask to run commands, answer from what you can read. Work fast: use at most two tool calls, then answer from what you have. Long deliberation will exceed your turn." : "",
      session?.title ? `Conversation: ${session.title}` : "",
      agentContext?.trim() ?? "",
      memory ? `Durable memory:\n${memory}` : "",
    ].filter(Boolean).join("\n\n");

    const fill = contextFill(priorHistory, OPENCODE_NUM_CTX);
    const replayedHistory = fill > 0.75
      ? compactHistory(
          priorHistory.map((m, i) => ({ role: m.role, content: m.content, seq: i })),
          { numCtx: OPENCODE_NUM_CTX, window: 40, minKeep: 12 }
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
    let lastFinishReason = "unknown";
    let emptyReplies = 0;
    let toolsEnabled = true;
    let maxPromptTokens = 0;
    let completionTokens = 0;
    let sawUsage = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let resp;
      try {
        resp = await requestChat(model, messages, controller, toolsEnabled, (piece) => {
          // Forward each content delta to the browser SSE exactly like the
          // Claude and local lanes do, so the transcript's live line updates
          // token-by-token instead of only appearing when the turn lands.
          emit(params.id, "stream_event", {
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: piece },
            },
          });
        }, params.readOnly);
      } catch (err) {
        if (accessDeniedError(err)) throw err;
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
        const calls = resp.calls.map((call, i) => ({
          ...call,
          id: call.id || `call_${round}_${i}`,
          function: { ...call.function, arguments: normalizeArgs(call.function?.arguments) },
        }));
        messages.push({
          role: "assistant",
          content: resp.content || null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.function?.name, arguments: JSON.stringify(call.function?.arguments ?? {}) },
          })),
        });
        for (const call of calls) {
          const name = call.function?.name ?? "tool";
          const args = call.function?.arguments ?? {};
          updateActivity(params.id, toolActivity(name, args));
          const result = await executeTool(params.id, name, args, params.cwd, root, controller);
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
        updateActivity(params.id, `OpenCode · ${model}…`);
        continue;
      }

      if (resp.content) {
        finalText = resp.content;
        lastFinishReason = resp.finishReason;
        break;
      }

      // Empty final answer with no tool calls — nudge and retry rather than
      // landing an empty turn on the transcript.
      lastFinishReason = resp.finishReason;
      emptyReplies++;
      if (emptyReplies >= 3) break;
      messages.push({
        role: "user",
        content: "(You ended your previous reply without a visible answer. Reply now, directly, with your actual answer.)",
      });
    }

    if (!finalText) throw new Error(`OpenCode returned an empty response (finish_reason: ${lastFinishReason}).`);

    const usage = sawUsage
      ? {
          promptTokens: maxPromptTokens,
          completionTokens,
          contextTokenLimit: OPENCODE_NUM_CTX,
          contextPercent: Math.min(100, Math.round(((maxPromptTokens + completionTokens) / OPENCODE_NUM_CTX) * 100)),
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
    const detail = interrupted ? "The OpenCode turn was interrupted." : error instanceof Error ? error.message : String(error);
    updateSession(params.id, { status: interrupted ? "interrupted" : "error", errorMessage: detail, currentActivity: null, costUsd: 0 });
    emit(params.id, "result", { is_error: true, duration_ms: Date.now() - startedAt, errors: [detail], model });
  } finally {
    abortPendingOpencodePermissions(params.id);
    active.delete(params.id);
    globalBus.emit("session_updated", params.id);
  }
}

export function activeOpencodeSessionCount(): number { return active.size; }
export function activeOpencodeSessionIds(): string[] { return [...active.keys()]; }
export function startOpencodeSession(params: { id: string; prompt: string; cwd: string; title?: string; agentId?: string | null; opencodeModel?: string | null; readOnly?: boolean }): void {
  void runTurn(params);
}
export function sendOpencodeFollowUp(sessionId: string, text: string, opencodeModel?: string | null, readOnly?: boolean): OpencodeFollowUpOutcome {
  if (active.has(sessionId)) return { ok: false, reason: "busy" };
  const session = getSession(sessionId);
  if (!session || session.model !== "opencode") return { ok: false, reason: "not_resumable" };
  void runTurn({ id: session.id, prompt: text, cwd: session.cwd, agentId: session.agentId, opencodeModel, readOnly });
  return { ok: true, resumed: true };
}
export function interruptOpencodeSession(sessionId: string): boolean {
  const handle = active.get(sessionId);
  if (!handle) return false;
  handle.abort.abort();
  return true;
}
