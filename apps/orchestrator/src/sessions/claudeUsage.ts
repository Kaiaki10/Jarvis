import type { ClaudeUsageSnapshot, ClaudeUsageWindow } from "@jarvis/shared";
import { globalBus } from "../events/globalBus.js";

/**
 * Latest subscription rate-limit state, as reported by the Claude Agent SDK.
 *
 * Held in memory rather than persisted: it describes the account right now, and
 * a stale row read at startup would be worse than showing nothing. Sessions
 * re-report it on their next turn, so it refills on its own.
 *
 * Keyed by window type — the SDK reports a five-hour and a seven-day window
 * separately, and they move independently.
 */
const windows = new Map<string, ClaudeUsageWindow>();

/**
 * The SDK's `utilization` arrives without a documented scale, and the bundled
 * CLI does not reveal one. Both conventions are accepted: a value at or below 1
 * is read as a fraction, anything above it as an already-percentage figure.
 * Guessing wrong in either direction would misreport by 100x, so neither is
 * assumed.
 */
function toPercent(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const percent = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.round(percent));
}

interface RateLimitInfoLike {
  status?: string;
  rateLimitType?: string;
  utilization?: number;
  resetsAt?: number;
}

/** Called for every `rate_limit_event` the SDK emits. */
export function recordRateLimit(info: unknown): void {
  const raw = info as RateLimitInfoLike | null | undefined;
  if (!raw || typeof raw !== "object") return;

  // Without a window type there is nothing to key on, and overwriting an
  // unrelated window would misreport the one thing this exists to report.
  const type = typeof raw.rateLimitType === "string" ? raw.rateLimitType : null;
  if (!type) return;

  const status =
    raw.status === "allowed_warning" || raw.status === "rejected" ? raw.status : "allowed";

  windows.set(type, {
    type,
    status,
    utilization: toPercent(raw.utilization),
    resetsAt: typeof raw.resetsAt === "number" ? raw.resetsAt : null,
    updatedAt: new Date().toISOString(),
  });

  globalBus.emit("claude_usage_changed");
}

export function getUsageSnapshot(): ClaudeUsageSnapshot {
  // Most-constrained first: with several windows live, the tightest one is the
  // one that will actually stop the next turn. Windows with no utilization
  // reading sort last — an unknown is not evidence of headroom, but it also
  // cannot outrank a window we can actually see filling up.
  const all = [...windows.values()].sort((a, b) => {
    if (a.utilization === null && b.utilization === null) {
      return (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity);
    }
    if (a.utilization === null) return 1;
    if (b.utilization === null) return -1;
    return b.utilization - a.utilization;
  });
  return { windows: all, binding: all[0] ?? null };
}

/** Test seam — the map is module state that would otherwise leak between cases. */
export function resetUsageForTests(): void {
  windows.clear();
}
