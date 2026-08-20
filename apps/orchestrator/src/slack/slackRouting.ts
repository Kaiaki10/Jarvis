import type { AgentRecord } from "@jarvis/shared";

export interface SlackAgentDirective {
  agent: AgentRecord | undefined;
  text: string;
  explicit: boolean;
}

export function parseSlackUserIds(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(/[\s,]+/).map((id) => id.trim()).filter(Boolean));
}

export function stripSlackMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, " ").replace(/\s+/g, " ").trim();
}

function startsWithAgent(text: string, prefix: string, agent: AgentRecord): boolean {
  const rest = text.slice(prefix.length);
  return rest.toLocaleLowerCase().startsWith(agent.name.toLocaleLowerCase()) &&
    /^(?:\s|:|$)/.test(rest.slice(agent.name.length));
}

/**
 * Selects an agent from `agent Name: …` or `Name: …`; otherwise keeps the
 * thread binding and finally falls back to the default active agent.
 */
export function routeSlackMessage(
  rawText: string,
  agents: AgentRecord[],
  boundAgentId?: string,
  defaultAgentId?: string
): SlackAgentDirective {
  const text = stripSlackMentions(rawText);
  const byLongestName = [...agents].sort((a, b) => b.name.length - a.name.length);
  const agentPrefix = /^\/?agent\s+/i.test(text) ? text.match(/^\/?agent\s+/i)![0] : undefined;
  const matched = byLongestName.find((agent) =>
    agentPrefix ? startsWithAgent(text, agentPrefix, agent) : startsWithAgent(text, "", agent) && text[agent.name.length] === ":"
  );

  if (matched) {
    const offset = (agentPrefix?.length ?? 0) + matched.name.length;
    return { agent: matched, text: text.slice(offset).replace(/^\s*:\s*|^\s+/, "").trim(), explicit: true };
  }

  const selected = agents.find((agent) => agent.id === boundAgentId)
    ?? agents.find((agent) => agent.id === defaultAgentId)
    ?? agents[0];
  return { agent: selected, text, explicit: false };
}
