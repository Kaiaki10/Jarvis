/**
 * Pure context-management helpers for the local (Ollama) lane.
 *
 * Everything here is side effect free so it can be unit-tested without a
 * running Ollama: token estimation, lean turn replay, and a model-free
 * fallback summary that is used when the summarizer call itself fails.
 */

export interface LocalHistoryEntry {
  role: "user" | "assistant";
  content: string;
  seq: number;
}

/** ~4 characters per token is a decent heuristic for code + prose mix. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Array<{ content?: unknown }>): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === "string") total += estimateTextTokens(message.content);
  }
  return total;
}

export interface CompactOptions {
  numCtx?: number;
  /** Replay budget as a fraction of the window. */
  budgetFraction?: number;
  /** How many of the *newest* entries always survive (in order). */
  window?: number;
  /** Minimum number of entries to keep even when still over budget. */
  minKeep?: number;
  /** Per-message character caps (user first, assistant second). */
  userCap?: number;
  assistantCap?: number;
}

const DEFAULTS = { budgetFraction: 0.7, window: 10, minKeep: 4, userCap: 1_100, assistantCap: 1_600 };

function capContent(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n… (truncated)` : text;
}

/**
 * Returns a lean replay: caps long turns, keeps at least the NEWEST `window`
 * entries in order, and then drops the oldest entries until the remaining
 * estimate fits the budget. The newest turn always comes back intact-ish.
 */
export function compactHistory(
  entries: LocalHistoryEntry[],
  options: CompactOptions = {}
): LocalHistoryEntry[] {
  const opts = { ...DEFAULTS, ...options };
  const budgetTokens = (Number(opts.numCtx) || 32768) * (opts.budgetFraction ?? 0.7);

  const capped = entries
    .slice(-(opts.window ?? 10))
    .map((entry) => ({
      ...entry,
      content: capContent(entry.content, entry.role === "user" ? opts.userCap! : opts.assistantCap!),
    }));

  const result = [...capped];
  for (;;) {
    if (result.length <= (opts.minKeep ?? 4)) break;
    result.shift();
    if (result.length <= (opts.minKeep ?? 4)) break;
    if (estimateMessagesTokens(result) <= budgetTokens) break;
  }
  return result;
}

/** Fraction of the replay budget the entries would consume (0..1). */
export function contextFill(messages: Array<{ content?: unknown }>, numCtx: number): number {
  const numCtxTokens = Number(numCtx) || 32768;
  return Math.min(1, estimateMessagesTokens(messages) / (numCtxTokens * 0.7));
}

/**
 * Model-free fallback when the Ollama summarizer call itself fails: a compact
 * list of the user's earlier prompts so a compressed turn still knows roughly
 * what was being worked on. Keeps the model honest about what we actually
 * remember (AGENTS.md: never claim context that isn't there).
 */
export function buildFallbackSummary(entries: LocalHistoryEntry[], maxLen = 3_200): string {
  const prompts: string[] = [];
  for (const entry of entries) {
    if (entry.role !== "user") continue;
    const snippet = entry.content.replace(/\s+/g, " ").trim();
    if (!snippet) continue;
    prompts.push(snippet.length > 140 ? `${snippet.slice(0, 139)}…` : snippet);
  }
  if (!prompts.length) return "";
  const head = "Earlier turns covered these requests (auto-summarized without a model):";
  let summary = head;
  for (const prompt of prompts) {
    const line = `\n• ${prompt}`;
    if (summary.length + line.length > maxLen) break;
    summary += line;
  }
  return summary;
}
