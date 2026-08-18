import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { MemoryKind } from "@jarvis/shared";
import { listMemories, remember } from "../db/memoryRepo.js";
import { globalBus } from "../events/globalBus.js";

const MEMORY_POLICY = `You have durable, user-controlled memory with automatic reflection enabled.
- Before finishing every turn, review what the user stated and what was decided. Use the remember tool for every new durable preference, business fact, relationship detail, decision, or stable fact that will improve future sessions. The user does not need to say "remember this."
- If the turn contains no new durable information, do not invent a memory merely to show activity; the reflection itself is recorded separately.
- Store a short, self-contained fact, not a transcript. Never store passwords, API keys, private credentials, guesses, or short-lived details.
- Do not announce that you remembered something unless the tool succeeded.
- Use list_memories when the user asks what you remember or when current durable memory may have changed outside this conversation.`;

export interface MemoryToolset {
  mcpServers: Record<string, McpSdkServerConfigWithInstance>;
  capabilitySummary: string;
  autoAllowTools: string[];
}

export function buildMemoryToolset(sessionId: string, onRemember?: (created: boolean) => void): MemoryToolset {
  const tools = [
    tool(
      "remember",
      "Save one durable, user-approved fact for future Jarvis conversations.",
      {
        kind: z.enum(["preference", "business", "relationship", "decision", "fact"]),
        content: z.string().trim().min(3).max(1_000),
      },
      async ({ kind, content }) => {
        const result = remember({
          kind: kind as MemoryKind,
          content,
          sourceSessionId: sessionId,
        });
        onRemember?.(result.created);
        globalBus.emit("memories_changed");
        return {
          content: [
            {
              type: "text" as const,
              text: result.created
                ? `Remembered: ${result.memory.content}`
                : `Memory confirmed: ${result.memory.content}`,
            },
          ],
        };
      }
    ),
    tool(
      "list_memories",
      "Read the user's currently active Jarvis memories.",
      {},
      async () => ({
        content: [
          {
            type: "text" as const,
            text:
              listMemories("active")
                .map((memory) => `[${memory.kind}] ${memory.content}`)
                .join("\n") || "No active memories.",
          },
        ],
      })
    ),
  ];

  return {
    mcpServers: {
      memory: createSdkMcpServer({ name: "memory", version: "1.0.0", tools }),
    },
    capabilitySummary: MEMORY_POLICY,
    autoAllowTools: ["mcp__memory__remember", "mcp__memory__list_memories"],
  };
}
