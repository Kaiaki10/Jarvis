/**
 * Who speaks next in a room, and when the room must stop.
 *
 * Kept as pure functions, apart from the session plumbing, because these are
 * the rules that prevent a pair of agents talking to each other all night. A
 * bug here costs real quota while nobody is watching, so it is testable
 * directly rather than only through a live room.
 */

export interface Participant {
  agentId: string;
  name: string;
  position: number;
}

/**
 * The agent addressed by name in a message.
 *
 * Matching is on `@name` rather than a bare name so that merely discussing an
 * agent ("Atlas already covered that") does not hand it the floor. Longer names
 * are tried first, so `@Atlas Prime` is not read as `@Atlas`.
 */
export function parseMention(text: string, participants: Participant[]): string | null {
  const byLength = [...participants].sort((a, b) => b.name.length - a.name.length);
  for (const participant of byLength) {
    const escaped = participant.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A trailing boundary stops "@Ana" matching inside "@Anabel".
    if (new RegExp(`@${escaped}\\b`, "i").test(text)) return participant.agentId;
  }
  return null;
}

/**
 * The next speaker: whoever was addressed, else the next agent in order.
 *
 * An agent is never handed the floor by its own mention — an agent writing
 * "@Atlas" while being Atlas would otherwise loop on itself forever.
 */
export function chooseNextSpeaker(
  lastMessage: string,
  participants: Participant[],
  lastSpeakerId: string | null
): string | null {
  if (participants.length === 0) return null;
  const ordered = [...participants].sort((a, b) => a.position - b.position);

  const mentioned = parseMention(lastMessage, ordered);
  if (mentioned && mentioned !== lastSpeakerId) return mentioned;

  if (!lastSpeakerId) return ordered[0].agentId;
  const index = ordered.findIndex((p) => p.agentId === lastSpeakerId);
  if (index === -1) return ordered[0].agentId;
  return ordered[(index + 1) % ordered.length].agentId;
}

export type StopReason =
  | { stop: false }
  | { stop: true; reason: string };

/**
 * Whether the room must stop before another turn.
 *
 * Checked before each turn rather than after, so a room can never exceed its
 * cap by one final expensive turn.
 */
export function shouldStop(room: {
  status: string;
  turnsUsed: number;
  turnCap: number;
  budgetSeconds: number;
  startedAt: string | null;
  now?: number;
}): StopReason {
  if (room.status === "stopped") {
    return { stop: true, reason: "Stopped by you." };
  }
  if (room.turnsUsed >= room.turnCap) {
    return { stop: true, reason: `Reached the turn limit of ${room.turnCap}.` };
  }
  if (room.startedAt) {
    const now = room.now ?? Date.now();
    const elapsedSeconds = (now - new Date(room.startedAt).getTime()) / 1000;
    if (elapsedSeconds >= room.budgetSeconds) {
      return {
        stop: true,
        reason: `Reached the time budget of ${Math.round(room.budgetSeconds / 60)} minutes.`,
      };
    }
  }
  return { stop: false };
}

/**
 * An agent's view of the room so far.
 *
 * Every line is attributed, and the agent is told which name is its own —
 * without that it cannot tell its own past turns from the others', and starts
 * replying to itself.
 */
export function buildTurnPrompt(input: {
  speakerName: string;
  others: string[];
  topic: string;
  transcript: Array<{ speakerName: string; body: string }>;
  turnsRemaining: number;
}): string {
  const lines = [
    `You are ${input.speakerName}, taking part in a conversation with ${input.others.join(", ") || "no one else"}.`,
    "",
    `Topic: ${input.topic}`,
    "",
  ];

  if (input.transcript.length) {
    lines.push("Conversation so far:");
    for (const message of input.transcript) {
      lines.push(`${message.speakerName}: ${message.body}`);
    }
    lines.push("");
  }

  lines.push(
    "Reply as yourself, in your own voice, with your next contribution only.",
    "Do not prefix your reply with your own name — that is added for you.",
    "Address someone directly with @Name to hand them the next turn.",
    // A room is finite, and an agent that knows it is finite converges instead
    // of padding until the cap cuts it off mid-thought.
    `About ${input.turnsRemaining} turns remain, so work toward a conclusion rather than restating.`,
    "If the topic is settled, say so plainly and end with DONE on its own line."
  );

  return lines.join("\n");
}

/** An agent signalling that the conversation has reached its end. */
export function isConclusion(text: string): boolean {
  return /(^|\n)\s*DONE\s*$/i.test(text.trimEnd());
}
