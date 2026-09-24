import { existsSync, statSync } from "node:fs";
import { getAgent } from "../db/agentRepo.js";
import {
  createSession,
  getAgentChatSessionId,
  getSession,
  getSettings,
  latestSessionEventSeq,
  setAgentChatSessionId,
} from "../db/repo.js";
import { globalBus } from "../events/globalBus.js";
import { activeSessionCount, atConcurrencyLimit, sendFollowUp, startSession } from "../sessions/sessionManager.js";
import {
  activeCodexSessionCount,
  sendCodexFollowUp,
  startCodexSession,
} from "../sessions/codexSessionManager.js";
import type { ChatModel, ClaudeModel } from "@jarvis/shared";
import { sendLocalFollowUp, startLocalSession } from "../sessions/localSessionManager.js";
import { sendOpencodeFollowUp, startOpencodeSession, activeOpencodeSessionCount } from "../sessions/opencodeSessionManager.js";

export type AgentChatFailureReason = "agent_not_found" | "working_directory_missing" | "at_capacity" | "busy";

export type AgentChatOutcome =
  | { ok: true; sessionId: string; resumed: boolean; afterSeq: number }
  | { ok: false; reason: AgentChatFailureReason; message: string };

/** One continuous agent conversation, regardless of whether the turn came from the dashboard or Slack. */
export function sendAgentChat(
  agentId: string,
  text: string,
  model: ChatModel = "claude",
  claudeModel?: ClaudeModel,
  autoApproveLocalTools?: boolean,
  localModel?: string | null,
  opencodeModel?: string | null
): AgentChatOutcome {
  const agent = getAgent(agentId);
  if (!agent || agent.status !== "active") {
    return { ok: false, reason: "agent_not_found", message: "That agent is not available." };
  }

  const totalActive = () => activeSessionCount() + activeCodexSessionCount() + activeOpencodeSessionCount();
  const atTotalCapacity = () => totalActive() >= getSettings().maxConcurrentSessions;
  const capacityMessage = () =>
    `Jarvis is at its active-session limit (${totalActive()}/${getSettings().maxConcurrentSessions}). Try again when a run finishes.`;

  const existingId = getAgentChatSessionId(agentId, model);
  const existing = existingId ? getSession(existingId) : undefined;
  if (existing) {
    const afterSeq = latestSessionEventSeq(existing.id);
    if (!["running", "starting", "waiting_permission"].includes(existing.status) && atTotalCapacity()) {
      return { ok: false, reason: "at_capacity", message: capacityMessage() };
    }
    const outcome = model === "gpt-5.6-sol"
      ? sendCodexFollowUp(existing.id, text)
      : model === "local"
        ? sendLocalFollowUp(existing.id, text, localModel)
        : model === "opencode"
          ? sendOpencodeFollowUp(existing.id, text, opencodeModel)
          : sendFollowUp(existing.id, text, { memoryWritable: true, claudeModel, autoApproveLocalTools });
    if (outcome.ok) return { ok: true, sessionId: existing.id, resumed: outcome.resumed, afterSeq };
    if (outcome.reason === "busy") {
      const busyLabel = model === "gpt-5.6-sol" ? "GPT-5.6 Sol" : model === "local" ? "The local model" : model === "opencode" ? "The OpenCode model" : "Jarvis";
      return { ok: false, reason: "busy", message: `${busyLabel} is still answering the previous message.` };
    }
    if (outcome.reason === "at_capacity") {
      return {
        ok: false,
        reason: "at_capacity",
        message: capacityMessage(),
      };
    }
  }

  const cwd = agent.cwd.trim() || getSettings().chatWorkingDirectory.trim() || process.cwd();
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return {
      ok: false,
      reason: "working_directory_missing",
      message: `The working directory for ${agent.name} does not exist. Update the agent in Jarvis Settings.`,
    };
  }
  if (atConcurrencyLimit() || atTotalCapacity()) {
    return {
      ok: false,
      reason: "at_capacity",
      message: capacityMessage(),
    };
  }

  const session = createSession({
    title: agent.name,
    cwd,
    permissionMode: agent.permissionMode ?? "default",
    agentId,
    model,
    claudeModel,
    localModel: model === "local" ? localModel ?? undefined : undefined,
    opencodeModel: model === "opencode" ? opencodeModel ?? undefined : undefined,
    autoApproveLocalTools,
  });
  setAgentChatSessionId(agentId, session.id, model);
  globalBus.emit("session_updated", session.id);
  globalBus.emit("chat_changed");

  if (model === "gpt-5.6-sol") {
    startCodexSession({ id: session.id, prompt: text, cwd, title: agent.name, agentId });
  } else if (model === "local") {
    startLocalSession({ id: session.id, prompt: text, cwd, title: agent.name, agentId, localModel });
  } else if (model === "opencode") {
    startOpencodeSession({ id: session.id, prompt: text, cwd, title: agent.name, agentId, opencodeModel });
  } else {
    void startSession({
      id: session.id,
      prompt: text,
      cwd,
      permissionMode: agent.permissionMode ?? "default",
      title: agent.name,
      memoryWritable: true,
      agentId,
      claudeModel,
      autoApproveLocalTools,
    });
  }

  return { ok: true, sessionId: session.id, resumed: false, afterSeq: 0 };
}
