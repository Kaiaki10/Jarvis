"use client";

import type { ClaudeUsageWindow } from "@jarvis/shared";
import { useClaudeUsage } from "@/lib/store";

/** "five_hour" → "5h", "seven_day_opus" → "7d Opus". */
function windowLabel(type: string): string {
  if (type === "overage") return "Overage";
  if (type === "seven_day_overage_included") return "7d +overage";
  const [, , model] = type.split("_");
  const base = type.startsWith("five_hour") ? "5h" : type.startsWith("seven_day") ? "7d" : type;
  return model ? `${base} ${model[0].toUpperCase()}${model.slice(1)}` : base;
}

function resetPhrase(resetsAt: number | null): string | null {
  if (!resetsAt) return null;
  // The SDK reports seconds; a value large enough to be milliseconds is treated
  // as such rather than landing the reset fifty thousand years out.
  const ms = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  const minutes = Math.round((ms - Date.now()) / 60000);
  if (minutes <= 0) return "resets any moment";
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `resets in ${hours}h ${minutes % 60}m`;
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function toneOf(w: ClaudeUsageWindow): { stroke: string; text: string } {
  if (w.status === "rejected") return { stroke: "var(--danger)", text: "text-danger" };
  if (w.status === "allowed_warning" || (w.utilization ?? 0) >= 80) {
    return { stroke: "var(--warning)", text: "text-warning" };
  }
  return { stroke: "var(--accent)", text: "text-foreground-secondary" };
}

const R = 6;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Subscription headroom, not spend. The plan already covers this usage, so a
 * dollar figure would imply a bill that does not exist (see CLAUDE.md) — what
 * is worth knowing is how much of the window is gone and when it comes back.
 *
 * The SDK reports `utilization` only sometimes; on an ordinary allowed turn it
 * sends the window and its reset time and nothing else. That case shows the
 * reset alone rather than a fabricated 0%, since claiming a full tank on no
 * evidence is worse than admitting the number isn't known.
 *
 * Renders nothing at all until a session has reported a window — the SDK only
 * speaks up once a turn actually runs, so an empty state would be a permanent
 * fixture on a freshly started service.
 */
export function ClaudeUsageBadge() {
  const usage = useClaudeUsage();
  const binding = usage?.binding;
  if (!binding) return null;

  const tone = toneOf(binding);
  const reset = resetPhrase(binding.resetsAt);
  const known = binding.utilization !== null;

  const detail = (usage?.windows ?? [])
    .map((w) => {
      const pct = w.utilization === null ? "usage not reported" : `${w.utilization}% used`;
      const when = resetPhrase(w.resetsAt);
      return `${windowLabel(w.type)}: ${pct}${when ? ` · ${when}` : ""}`;
    })
    .join("\n");

  return (
    <div
      className="hidden items-center gap-1.5 rounded-xl border border-border bg-black/25 px-2.5 py-1 text-micro sm:flex"
      title={`Claude subscription\n\n${detail}`}
      aria-label={
        known
          ? `Claude usage: ${binding.utilization}% of the ${windowLabel(binding.type)} window used${reset ? `, ${reset}` : ""}`
          : `Claude ${windowLabel(binding.type)} window${reset ? `, ${reset}` : ""}`
      }
    >
      <svg width="16" height="16" viewBox="0 0 16 16" className="-rotate-90" aria-hidden="true">
        <circle cx="8" cy="8" r={R} fill="none" stroke="var(--border-strong)" strokeWidth="2" />
        {known && (
          <circle
            cx="8"
            cy="8"
            r={R}
            fill="none"
            stroke={tone.stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${((binding.utilization ?? 0) / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          />
        )}
        {!known && <circle cx="8" cy="8" r="2" fill={tone.stroke} />}
      </svg>
      {known && <span className={`tabular-nums font-medium ${tone.text}`}>{binding.utilization}%</span>}
      <span className="text-muted">{known ? windowLabel(binding.type) : (reset ?? windowLabel(binding.type))}</span>
    </div>
  );
}
