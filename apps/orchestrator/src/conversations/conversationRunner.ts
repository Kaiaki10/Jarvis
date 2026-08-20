import {
  appendConversationMessage,
  getConversation,
  listConversationMessages,
  listParticipants,
  setParticipantSession,
  updateConversation,
} from "../db/conversationRepo.js";
import { createSession, getSession } from "../db/repo.js";
import { getAgent } from "../db/agentRepo.js";
import { globalBus } from "../events/globalBus.js";
import {
  buildTurnPrompt,
  chooseNextSpeaker,
  isConclusion,
  shouldStop,
} from "./turnEngine.js";
import {
  atConcurrencyLimit,
  interruptSession,
  sendFollowUp,
  startSession,
} from "../sessions/sessionManager.js";
import type { SessionEventRecord } from "@jarvis/shared";

/**
 * Rooms currently being driven, so a second start cannot run the same room
 * twice and double every turn.
 */
const running = new Set<string>();

/** A single turn is bounded too, or one wedged agent stalls the room forever. */
const TURN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Rooms run unattended by design (turn cap and wall-clock budget are the
 * safety limits, not a human watching every turn), so a participant asking
 * to read a file can't wait on canUseTool — the default approval timeout is
 * hours, far longer than TURN_TIMEOUT_MS, so the turn would always be killed
 * before a human could realistically see and answer the prompt. Bash, Edit,
 * Write, and platform actions stay gated; a room can consult docs on its own
 * but still can't act without a person in the loop.
 */
const ROOM_ALLOWED_TOOLS = ["Read", "Glob", "Grep"];

export function isConversationRunning(id: string): boolean {
  return running.has(id);
}

/**
 * Waits for one agent's turn to finish and returns what it said.
 *
 * The SDK reports completion through the event stream rather than by resolving
 * a promise, so this listens for that session's `result` event. The timeout is
 * the backstop: without it a session that never completes would hold the room
 * open indefinitely.
 */
function awaitTurn(sessionId: string): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (outcome: { ok: boolean; text: string }) => {
      if (settled) return;
      settled = true;
      globalBus.off("session_event", onEvent);
      clearTimeout(timer);
      resolve(outcome);
    };

    const onEvent = (event: SessionEventRecord) => {
      if (event.sessionId !== sessionId || event.type !== "result") return;
      const payload = event.payload as { is_error?: boolean; result?: unknown };
      finish({
        ok: !payload.is_error,
        text: typeof payload.result === "string" ? payload.result : "",
      });
    };

    const timer = setTimeout(() => {
      void interruptSession(sessionId);
      finish({ ok: false, text: "" });
    }, TURN_TIMEOUT_MS);

    globalBus.on("session_event", onEvent);
  });
}

function endRoom(id: string, status: "completed" | "stopped" | "error", reason: string): void {
  updateConversation(id, {
    status,
    endedAt: new Date().toISOString(),
    stopReason: reason,
  });
  globalBus.emit("conversations_changed");
}

/**
 * Drives a room until a stop condition is met.
 *
 * Agents speak one at a time, which is what keeps a room costing a single
 * concurrency slot rather than one per participant.
 */
export async function runConversation(conversationId: string): Promise<void> {
  if (running.has(conversationId)) return;
  running.add(conversationId);

  try {
    const participants = listParticipants(conversationId);
    if (participants.length < 2) {
      endRoom(conversationId, "error", "A conversation needs at least two agents.");
      return;
    }

    const room = getConversation(conversationId);
    if (!room) return;

    updateConversation(conversationId, {
      status: "running",
      startedAt: room.startedAt ?? new Date().toISOString(),
      endedAt: null,
      stopReason: null,
    });
    globalBus.emit("conversations_changed");

    let lastSpeakerId: string | null = null;
    const existing = listConversationMessages(conversationId);
    if (existing.length) lastSpeakerId = existing[existing.length - 1].speakerAgentId;

    for (;;) {
      // Re-read every turn: a human may have pressed stop, and the turn count
      // has moved since the loop began.
      const current = getConversation(conversationId);
      if (!current) return;

      const stop = shouldStop({
        status: current.status,
        turnsUsed: current.turnsUsed,
        turnCap: current.turnCap,
        budgetSeconds: current.budgetSeconds,
        startedAt: current.startedAt,
      });
      if (stop.stop) {
        endRoom(conversationId, current.status === "stopped" ? "stopped" : "completed", stop.reason);
        return;
      }

      // A room must not squeeze out the rest of the system; it waits its turn
      // like anything else rather than failing.
      if (atConcurrencyLimit()) {
        endRoom(
          conversationId,
          "stopped",
          "Paused: too many sessions were running at once. Start it again when the system is quieter."
        );
        return;
      }

      const transcript = listConversationMessages(conversationId);
      const lastBody = transcript.length ? transcript[transcript.length - 1].body : current.topic;
      const nextId = chooseNextSpeaker(lastBody, participants, lastSpeakerId);
      if (!nextId) {
        endRoom(conversationId, "error", "No agent available to speak.");
        return;
      }

      const speaker = participants.find((p) => p.agentId === nextId)!;
      const agent = getAgent(speaker.agentId);
      if (!agent) {
        endRoom(conversationId, "error", `${speaker.name} no longer exists.`);
        return;
      }

      const prompt = buildTurnPrompt({
        speakerName: speaker.name,
        others: participants.filter((p) => p.agentId !== nextId).map((p) => p.name),
        topic: current.topic,
        transcript: transcript.map((m) => ({ speakerName: m.speakerName, body: m.body })),
        turnsRemaining: Math.max(1, current.turnCap - current.turnsUsed),
      });

      // Each participant keeps one session for the whole room, so an agent
      // remembers its own earlier turns rather than meeting the room afresh.
      let sessionId = speaker.sessionId;
      const live = sessionId ? getSession(sessionId) : undefined;
      let outcome: { ok: boolean; text: string };

      if (!sessionId || !live) {
        const cwd = agent.cwd.trim() || process.cwd();
        const session = createSession({
          title: `${current.title} — ${agent.name}`,
          cwd,
          permissionMode: agent.permissionMode,
          allowedTools: ROOM_ALLOWED_TOOLS,
          agentId: agent.id,
        });
        sessionId = session.id;
        setParticipantSession(conversationId, agent.id, sessionId);
        speaker.sessionId = sessionId;
        globalBus.emit("session_updated", sessionId);

        const turnPromise = awaitTurn(sessionId);
        void startSession({
          id: sessionId,
          prompt,
          cwd,
          permissionMode: agent.permissionMode,
          allowedTools: ROOM_ALLOWED_TOOLS,
          title: `${agent.name} in ${current.title}`,
          agentId: agent.id,
        });
        outcome = await turnPromise;
      } else {
        const turnPromise = awaitTurn(sessionId);
        const sent = sendFollowUp(sessionId, prompt);
        if (!sent.ok) {
          endRoom(conversationId, "error", `${agent.name} could not continue (${sent.reason}).`);
          return;
        }
        outcome = await turnPromise;
      }

      const spoken = outcome.text.trim();
      if (!outcome.ok || !spoken) {
        // Pressing stop interrupts whoever is mid-sentence, so the turn fails
        // by design. Reporting that as an error would make a working emergency
        // brake look like a crash, which is exactly when a person needs to
        // trust what the screen says.
        const afterTurn = getConversation(conversationId);
        if (afterTurn?.status === "stopped") {
          endRoom(conversationId, "stopped", afterTurn.stopReason ?? "Stopped by you.");
          return;
        }
        endRoom(conversationId, "error", `${agent.name} did not reply.`);
        return;
      }

      const turn = current.turnsUsed + 1;
      appendConversationMessage({
        conversationId,
        turn,
        speakerAgentId: agent.id,
        speakerName: agent.name,
        // The marker is a control signal, not part of what was said.
        body: spoken.replace(/(^|\n)\s*DONE\s*$/i, "").trim() || spoken,
      });
      updateConversation(conversationId, { turnsUsed: turn });
      globalBus.emit("conversations_changed");
      lastSpeakerId = agent.id;

      if (isConclusion(spoken)) {
        endRoom(conversationId, "completed", `${agent.name} concluded the conversation.`);
        return;
      }
    }
  } catch (err) {
    endRoom(
      conversationId,
      "error",
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    running.delete(conversationId);
  }
}

/**
 * Asks a room to stop.
 *
 * Marks it stopped so the loop halts before its next turn, and interrupts the
 * agent currently mid-sentence rather than waiting for it to finish.
 */
export async function stopConversation(conversationId: string): Promise<void> {
  updateConversation(conversationId, {
    status: "stopped",
    endedAt: new Date().toISOString(),
    stopReason: "Stopped by you.",
  });
  for (const participant of listParticipants(conversationId)) {
    if (participant.sessionId) await interruptSession(participant.sessionId);
  }
  globalBus.emit("conversations_changed");
}
