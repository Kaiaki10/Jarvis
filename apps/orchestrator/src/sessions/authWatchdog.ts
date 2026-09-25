import { listSessions } from "../db/repo.js";
import { notify } from "../notifications/notifier.js";
import type { ChatModel } from "@jarvis/shared";

const CHECK_INTERVAL_MS = 5 * 60_000;
/** Only sessions that failed inside this window count — older ones were already surfaced. */
const RECENT_ERROR_MS = 10 * 60_000;

export interface LaneOutage {
  lane: string;
  title: string;
  body: string;
}

/**
 * Maps a failed turn's stored error to the outage behind it, if it names one.
 * Signatures come from errors observed live, not guessed: the Claude OAuth
 * expiry that killed every lane at once, Ollama refusing connections, and
 * the Inference free-tier refusal. Anything unrecognized returns null rather
 * than inventing a diagnosis — an unknown failure still notifies through the
 * normal session-failed path.
 */
export function classifyLaneError(
  model: ChatModel | string,
  errorMessage: string | null | undefined
): LaneOutage | null {
  if (!errorMessage) return null;
  if (/oauth session expired|could not be refreshed|authentication_failed/i.test(errorMessage)) {
    return {
      lane: "claude",
      title: "Claude login expired",
      body: "Claude's login on this machine expired, so dashboard chat, automations, and rooms on the Claude lane are failing. Open a terminal here and re-authenticate Claude Code, then retry. Nothing needs rebuilding.",
    };
  }
  if (/FreeTierError|free tier|OPENCODE_API_KEY/i.test(errorMessage)) {
    return {
      lane: "opencode",
      title: "OpenCode calls are being refused",
      body: "OpenCode's free tier only answers inside OpenCode itself. Set OPENCODE_API_KEY on the orchestrator to a Console service-account key and restart, or switch the conversation back to a local model.",
    };
  }
  if (
    model === "local" &&
    (/Ollama returned HTTP|Ollama returned no streaming body|fetch failed|ECONNREFUSED/i.test(errorMessage))
  ) {
    return {
      lane: "local",
      title: "Ollama is not answering",
      body: "Local chats are failing because Ollama is not reachable at 127.0.0.1:11434. Start Ollama and retry — no keys or accounts involved.",
    };
  }
  return null;
}

/**
 * Signatures already alerted. Keyed by outage, not session: fifty sessions
 * failing on the same expired login produce one notification, not fifty.
 * Rebuilt every tick from what is still failing, so a resolved outage drops
 * out and a recurrence notifies again.
 */
const alerted = new Set<string>();

function signatureOf(outage: LaneOutage): string {
  return `${outage.lane}:${outage.title}`;
}

export function checkAuthHealth(now = Date.now()): number {
  const cutoff = new Date(now - RECENT_ERROR_MS).toISOString();
  const stillFailing = new Set<string>();
  let notified = 0;
  for (const session of listSessions()) {
    if (session.status !== "error") continue;
    if (session.updatedAt < cutoff) continue;
    const outage = classifyLaneError(session.model, session.errorMessage);
    if (!outage) continue;
    const signature = signatureOf(outage);
    stillFailing.add(signature);
    if (alerted.has(signature)) continue;
    alerted.add(signature);
    notified += 1;
    notify({
      type: "session_failed",
      severity: "error",
      title: outage.title,
      body: outage.body,
      sessionId: session.id,
    });
  }
  for (const signature of [...alerted]) {
    if (!stillFailing.has(signature)) alerted.delete(signature);
  }
  return notified;
}

/** For tests: forget past alerts without waiting for a restart. */
export function resetAuthHealthAlerts(): void {
  alerted.clear();
}

export function startAuthWatchdog(): void {
  try {
    checkAuthHealth();
  } catch (error) {
    console.error("[auth-watchdog] initial check failed:", error);
  }
  setInterval(() => {
    try {
      checkAuthHealth();
    } catch (error) {
      console.error("[auth-watchdog] check failed:", error);
    }
  }, CHECK_INTERVAL_MS);
}
