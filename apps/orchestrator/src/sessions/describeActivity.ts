import { basename } from "node:path";

/**
 * Turns a raw SDK message into a short human line describing what the run is
 * doing right now — "Editing store.tsx", "Running npm test".
 *
 * Derived from events we already receive, so a live progress line costs nothing
 * extra. Returns null for messages that say nothing worth showing, so the last
 * meaningful activity stays on screen instead of flickering.
 */

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
}

function shortenPath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return basename(value);
}

function firstLine(value: unknown, max = 60): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const line = value.trim().split("\n")[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function describeToolUse(block: ToolUseBlock): string | null {
  const name = block.name ?? "";
  const input = block.input ?? {};

  // Platform actions are the ones worth naming precisely.
  if (name.startsWith("mcp__jarvis__")) {
    const bare = name.replace("mcp__jarvis__", "");
    if (bare === "list_available_images") return "Checking available images";
    return `Preparing to ${bare.replace(/_/g, " ")}`;
  }

  switch (name) {
    case "Bash": {
      const command = firstLine(input.command, 50);
      return command ? `Running ${command}` : "Running a command";
    }
    case "Read":
      return `Reading ${shortenPath(input.file_path) ?? "a file"}`;
    case "Write":
      return `Writing ${shortenPath(input.file_path) ?? "a file"}`;
    case "Edit":
      return `Editing ${shortenPath(input.file_path) ?? "a file"}`;
    case "Glob":
    case "Grep":
      return "Searching the codebase";
    case "TodoWrite":
      return "Planning";
    case "WebSearch":
    case "WebFetch":
      return "Looking something up";
    default:
      return name ? `Using ${name}` : null;
  }
}

export function describeActivity(message: unknown): string | null {
  const msg = message as {
    type?: string;
    message?: { content?: unknown };
  };

  if (msg.type !== "assistant") return null;
  const content = msg.message?.content;
  if (!Array.isArray(content)) return null;

  // A tool call describes the work better than the sentence introducing it.
  for (const block of content as ToolUseBlock[]) {
    if (block?.type === "tool_use") {
      const described = describeToolUse(block);
      if (described) return described;
    }
  }

  for (const block of content as Array<{ type: string; text?: string }>) {
    if (block?.type === "text") {
      const line = firstLine(block.text, 70);
      if (line) return line;
    }
  }

  return null;
}

/**
 * The run's own account of what it did, trimmed to one line.
 *
 * Takes the opening line rather than the closing one. A reply's first sentence
 * is nearly always the topic sentence, while the last is usually a supporting
 * detail — taking the end produced summaries that read as non-sequiturs.
 */
export function extractSummary(result: unknown): string | null {
  if (typeof result !== "string") return null;
  const text = result.trim();
  if (!text) return null;

  const lines = text
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*#>\s]+/, "")
        // Drop cheerful openers so the substance is not buried behind them.
        .replace(/^(great|perfect|done|ok|okay|alright|excellent)[!.,]?\s*/i, "")
        .trim()
    )
    .filter((line) => {
      if (!line) return false;
      // A bare heading carries no information.
      if (/^(summary|result|results|done)[:.]?$/i.test(line)) return false;
      // A line ending in a colon introduces what follows rather than summarising
      // it — "Here are the results:" is the most common false summary there is.
      if (line.endsWith(":")) return false;
      return true;
    });

  // A one-line reply is already its own summary, so no special case is needed —
  // the first cleaned line covers both that and a longer write-up.
  const first = lines[0];
  if (!first) return null;

  return first.length > 300 ? `${first.slice(0, 299)}…` : first;
}
