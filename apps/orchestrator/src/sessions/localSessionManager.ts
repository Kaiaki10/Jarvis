import { appendSessionEvent, getSession, getSettings, listSessionEvents, updateSession } from "../db/repo.js";
import { buildMemoryContext, recordMemoryReflection } from "../db/memoryRepo.js";
import { getAgent } from "../db/agentRepo.js";
import { globalBus } from "../events/globalBus.js";
import type { SessionEventRecord } from "@jarvis/shared";

interface LocalHandle { abort: AbortController; }
export type LocalFollowUpOutcome =
  | { ok: true; resumed: boolean }
  | { ok: false; reason: "unknown_session" | "not_resumable" | "at_capacity" | "busy" };

const active = new Map<string, LocalHandle>();
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
// Qwen3-Coder-Next is the default local coding/agent model. The environment
// variable remains an intentional escape hatch for a smaller model on weaker
// hardware or for testing a different Ollama model.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3-coder-next:q4_K_M";

function publish(sessionId: string, event: SessionEventRecord): void {
  globalBus.emit("session_event", event);
}
function emit(sessionId: string, type: SessionEventRecord["type"], payload: unknown): void {
  publish(sessionId, appendSessionEvent(sessionId, type, payload));
}
function userTurn(sessionId: string, text: string): void {
  emit(sessionId, "user", { message: { role: "user", content: text } });
}
function assistantTurn(sessionId: string, text: string): void {
  emit(sessionId, "assistant", { message: { role: "assistant", model: OLLAMA_MODEL, content: text } });
}

function history(sessionId: string): Array<{ role: "user" | "assistant"; content: string }> {
  return listSessionEvents(sessionId)
    .filter((e) => e.type === "user" || e.type === "assistant")
    .map((e) => {
      const p = e.payload as { message?: { role?: string; content?: unknown } };
      const role = p.message?.role === "assistant" ? "assistant" : "user";
      const content = typeof p.message?.content === "string" ? p.message.content : "";
      return { role, content };
    })
    .filter((m) => m.content.trim());
}

async function runTurn(params: { id: string; prompt: string; cwd: string; agentId?: string | null }): Promise<void> {
  const controller = new AbortController();
  active.set(params.id, { abort: controller });
  const startedAt = Date.now();
  const priorHistory = history(params.id);
  userTurn(params.id, params.prompt);
  updateSession(params.id, { status: "running", currentActivity: `Running local LLM · ${OLLAMA_MODEL}…` });
  globalBus.emit("session_updated", params.id);

  try {
    const session = getSession(params.id);
    const agent = params.agentId ? getAgent(params.agentId) : undefined;
    const agentContext = agent?.systemPrompt?.trim() || getSettings().businessContext;
    const memory = buildMemoryContext(40, params.agentId ?? null);
    const system = [
      "You are Jarvis, a local AI assistant running on the user's computer.",
      "Be direct, useful, and honest about what you can access. This local lane does not have Jarvis's outbound platform tools.",
      session?.title ? `Conversation: ${session.title}` : "",
      agentContext?.trim() ?? "",
      memory ? `Durable memory:\n${memory}` : "",
    ].filter(Boolean).join("\n\n");

    const messages = [
      { role: "system", content: system },
      ...priorHistory.slice(-40),
      { role: "user", content: params.prompt },
    ];

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json() as { message?: { content?: string } };
    const reply = data.message?.content?.trim() ?? "";
    if (!reply) throw new Error("Ollama returned an empty response.");

    assistantTurn(params.id, reply);
    updateSession(params.id, {
      status: "idle",
      turns: (session?.turns ?? 0) + 1,
      summary: reply.replace(/\s+/g, " ").slice(0, 280),
      currentActivity: null,
      costUsd: 0,
    });
    emit(params.id, "result", {
      is_error: false,
      duration_ms: Date.now() - startedAt,
      result: reply,
      model: OLLAMA_MODEL,
    });
    recordMemoryReflection({ sessionId: params.id, status: "reviewed", memoriesAdded: 0, memoriesConfirmed: 0 });
    globalBus.emit("memories_changed");
  } catch (error) {
    const interrupted = controller.signal.aborted;
    const detail = interrupted ? "The local LLM turn was interrupted." : error instanceof Error ? error.message : String(error);
    updateSession(params.id, { status: interrupted ? "interrupted" : "error", errorMessage: detail, currentActivity: null, costUsd: 0 });
    emit(params.id, "result", { is_error: true, duration_ms: Date.now() - startedAt, errors: [detail], model: OLLAMA_MODEL });
  } finally {
    active.delete(params.id);
    globalBus.emit("session_updated", params.id);
  }
}

export function activeLocalSessionCount(): number { return active.size; }
export function startLocalSession(params: { id: string; prompt: string; cwd: string; title?: string; agentId?: string | null }): void {
  void runTurn(params);
}
export function sendLocalFollowUp(sessionId: string, text: string): LocalFollowUpOutcome {
  if (active.has(sessionId)) return { ok: false, reason: "busy" };
  const session = getSession(sessionId);
  if (!session || session.model !== "local") return { ok: false, reason: "not_resumable" };
  void runTurn({ id: session.id, prompt: text, cwd: session.cwd, agentId: session.agentId });
  return { ok: true, resumed: true };
}
export function interruptLocalSession(sessionId: string): boolean {
  const handle = active.get(sessionId);
  if (!handle) return false;
  handle.abort.abort();
  return true;
}
