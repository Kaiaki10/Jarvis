import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { oauth1Header } from "./oauth1.js";
import { listConnections, getConnectionCredentials } from "../db/connectionsRepo.js";
import { getPlatform } from "./definitions.js";

type Creds = Record<string, string>;

/**
 * Tools carry their zod input shape as a type parameter, and handler params are
 * contravariant, so differently shaped tools can't share an array type without
 * erasing it — the same erasure createSdkMcpServer's own options use. Each
 * builder casts once at its boundary; the shapes are still checked inside.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = SdkMcpToolDefinition<any>;

function erase(tools: unknown[]): AnyTool[] {
  return tools as AnyTool[];
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

const TIMEOUT_MS = 20_000;

function buildXTools(creds: Creds): AnyTool[] {
  return erase([
    tool(
      "post_to_x",
      "Publish a post to the connected X (Twitter) account. Use only when the user has asked for something to be posted publicly.",
      { text: z.string().max(280).describe("The post body. Max 280 characters.") },
      async (args) => {
        const url = "https://api.x.com/2/tweets";
        const header = oauth1Header("POST", url, {
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
          accessToken: creds.accessToken,
          accessTokenSecret: creds.accessTokenSecret,
        });
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: header, "Content-Type": "application/json" },
          body: JSON.stringify({ text: args.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await res.text();

        // X bills per post and stops at zero rather than overdrawing. Without
        // naming the cause this surfaces as a bare 402 that looks like a bug.
        if (res.status === 402) {
          return fail(
            "X rejected the post: your API credits are depleted. X charges per post " +
              "($0.015, or $0.20 if the text contains a URL). Buy credits in the X " +
              "Developer Console under Billing, and set a spending cap while you are there."
          );
        }
        if (res.status === 403) {
          return fail(
            "X accepted the credentials but refused to post (403). The access token is " +
              "probably read-only — set App permissions to Read and write, then regenerate " +
              "the access token and secret, since tokens keep the permission they were born with."
          );
        }
        if (res.status === 429) {
          return fail("X rate limit reached. Wait for the window to reset and try again.");
        }
        if (!res.ok) return fail(`X refused the post (HTTP ${res.status}): ${body}`);
        try {
          const parsed = JSON.parse(body) as { data?: { id?: string } };
          return ok(`Posted to X. Post id: ${parsed.data?.id ?? "unknown"}`);
        } catch {
          return ok("Posted to X.");
        }
      }
    ),
  ]);
}

function buildSlackTools(creds: Creds): AnyTool[] {
  return erase([
    tool(
      "post_to_slack",
      "Send a message to a Slack channel in the connected workspace.",
      {
        channel: z.string().describe("Channel name (e.g. #general) or channel ID."),
        text: z.string().describe("Message body. Slack markdown is supported."),
      },
      async (args) => {
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.botToken}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({ channel: args.channel, text: args.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; ts?: string };
        if (!data.ok) return fail(`Slack refused the message: ${data.error ?? "unknown error"}`);
        return ok(`Message sent to ${args.channel}.`);
      }
    ),
  ]);
}

function buildDiscordTools(creds: Creds): AnyTool[] {
  return erase([
    tool(
      "post_to_discord",
      "Send a message to a Discord channel the bot has access to.",
      {
        channelId: z.string().describe("Numeric Discord channel ID."),
        text: z.string().describe("Message body."),
      },
      async (args) => {
        const res = await fetch(
          `https://discord.com/api/v10/channels/${encodeURIComponent(args.channelId)}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${creds.botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ content: args.text }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }
        );
        if (!res.ok) {
          return fail(`Discord refused the message (HTTP ${res.status}): ${await res.text()}`);
        }
        return ok(`Message sent to Discord channel ${args.channelId}.`);
      }
    ),
  ]);
}

function buildResendTools(creds: Creds): AnyTool[] {
  return erase([
    tool(
      "send_email",
      "Send an email from the connected sending domain.",
      {
        to: z.string().describe("Recipient email address."),
        subject: z.string().describe("Subject line."),
        body: z.string().describe("Plain-text email body."),
      },
      async (args) => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: creds.fromAddress,
            to: [args.to],
            subject: args.subject,
            text: args.body,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          return fail(`Resend refused the email (HTTP ${res.status}): ${await res.text()}`);
        }
        return ok(`Email sent to ${args.to}.`);
      }
    ),
  ]);
}

const BUILDERS: Record<string, (creds: Creds) => AnyTool[]> = {
  x: buildXTools,
  slack: buildSlackTools,
  discord: buildDiscordTools,
  resend: buildResendTools,
};

export interface PlatformToolset {
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  /** Plain-English list of what's available, for the system prompt. */
  capabilitySummary: string;
}

/**
 * Builds tools for platforms that are connected AND passed their last test.
 * Exposing tools for a broken connection just invites confident failures.
 */
export function buildPlatformToolset(): PlatformToolset {
  const tools: AnyTool[] = [];
  const names: string[] = [];

  for (const connection of listConnections()) {
    if (connection.status !== "connected") continue;
    const builder = BUILDERS[connection.platformId];
    const creds = getConnectionCredentials(connection.platformId);
    if (!builder || !creds) continue;
    tools.push(...builder(creds));
    names.push(getPlatform(connection.platformId)?.definition.name ?? connection.platformId);
  }

  if (!tools.length) {
    return {
      capabilitySummary:
        "No external platforms are connected yet, so you cannot post or send anything. If asked to, explain that the platform needs connecting on the Connections page first.",
    };
  }

  return {
    mcpServers: {
      jarvis: createSdkMcpServer({ name: "jarvis", version: "1.0.0", tools }),
    },
    capabilitySummary: `Connected platforms you can act on: ${names.join(", ")}. Use the provided tools to post or send. Every outbound action requires the user's approval before it goes out, so draft carefully — assume what you send is final.`,
  };
}
