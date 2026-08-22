import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { oauth1Header } from "./oauth1.js";
import { listConnections, getConnectionCredentialsById } from "../db/connectionsRepo.js";
import { getPlatform } from "./definitions.js";
import { checkDailyCap, recordAction, isDuplicate, contentHash } from "./spendGuard.js";
import { notify } from "../notifications/notifier.js";
import { listImages, imagesFolder, readImage, mimeTypeFor } from "./media.js";
import { basename } from "node:path";
import { withPlatformLock } from "./platformLock.js";

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

/**
 * Wraps an outbound action with the daily cap. The check runs before the call so a
 * blocked action costs nothing, and the ledger is written only on success — a
 * failed request should not consume the day's budget.
 */
async function guarded(
  platformId: string,
  toolName: string,
  /** Which account this action is charged to. Caps and dedupe key on it. */
  connectionId: string | undefined,
  /**
   * May return `externalPostId` alongside its content. Returning it
   * structurally rather than only inside the prose matters: the id was
   * previously formatted into a sentence for the model and then discarded, so
   * nothing published could ever be looked up or measured again.
   */
  send: () => Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
    externalPostId?: string | null;
  }>,
  /** Post body, when there is one, for duplicate detection and the ledger. */
  content?: string,
  sessionId?: string
) {
  return withPlatformLock(platformId, async () => {
    const check = checkDailyCap(platformId, connectionId);
    if (!check.allowed) {
      notify({
        type: "session_failed",
        severity: "warning",
        title: "Daily platform limit reached",
        body: check.message ?? `Daily limit reached for ${platformId}.`,
      });
      return fail(check.message ?? "Daily limit reached.");
    }

    if (content && isDuplicate(platformId, content)) {
      return fail(
        `This exact text was already posted to ${platformId} within the last 30 days. ` +
          `${platformId === "x" ? "X rejects duplicates and still bills the attempt. " : ""}` +
          `Write something different rather than reposting.`
      );
    }

    const result = await send();
    if (!result.isError) {
      recordAction(platformId, toolName, sessionId ?? null, content ? contentHash(content) : null, result.externalPostId ?? null, connectionId ?? null);
    }
    return result;
  });
}

const TIMEOUT_MS = 20_000;

const X_MEDIA_BASE = "https://api.x.com/2/media/upload";

function xAuthHeader(creds: Creds, method: string, url: string): string {
  return oauth1Header(method, url, {
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
    accessToken: creds.accessToken,
    accessTokenSecret: creds.accessTokenSecret,
  });
}

/**
 * Neither a JSON nor a multipart body is form-encoded, so in both cases OAuth
 * 1.0a signs only the oauth_* parameters — the body stays out of the signature
 * base string.
 */
async function postToX(
  creds: Creds,
  url: string,
  body: BodyInit | undefined,
  step: string,
  contentType?: string
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: xAuthHeader(creds, "POST", url),
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (res.status === 402) {
    throw new Error(
      "X rejected the image upload: your API credits are depleted. Buy credits in the " +
        "X Developer Console under Billing, and set a spending cap while you are there."
    );
  }
  if (!res.ok) {
    throw new Error(`X rejected the image upload at ${step} (HTTP ${res.status}): ${text}`);
  }
  return text;
}

/**
 * Uploads an image to X and returns its media id.
 *
 * Uses the v2 chunked flow (INIT / APPEND / FINALIZE). The old
 * upload.twitter.com/1.1 endpoint was deprecated in March 2025 and answers a
 * well-formed request with "media type unrecognized", which reads like a problem
 * with the file rather than a dead endpoint.
 *
 * Images are capped at 5 MB elsewhere, so a single APPEND segment always suffices.
 */
async function uploadImageToX(creds: Creds, fileName: string): Promise<string> {
  const { bytes, path } = readImage(fileName);
  const mediaType = mimeTypeFor(path);

  const initBody = await postToX(
    creds,
    `${X_MEDIA_BASE}/initialize`,
    JSON.stringify({
      media_type: mediaType,
      total_bytes: bytes.length,
      media_category: "tweet_image",
    }),
    "INIT",
    "application/json"
  );

  const mediaId = (JSON.parse(initBody) as { data?: { id?: string } }).data?.id;
  if (!mediaId) throw new Error(`X returned no media id from INIT: ${initBody}`);

  const append = new FormData();
  append.append("segment_index", "0");
  append.append(
    "media",
    new Blob([new Uint8Array(bytes)], { type: mediaType }),
    basename(path)
  );
  await postToX(creds, `${X_MEDIA_BASE}/${mediaId}/append`, append, "APPEND");

  await postToX(creds, `${X_MEDIA_BASE}/${mediaId}/finalize`, undefined, "FINALIZE");

  return mediaId;
}

function buildXTools(creds: Creds, sessionId?: string, connectionId?: string): AnyTool[] {
  return erase([
    tool(
      "list_available_images",
      "List the images the user has placed in the Jarvis images folder, so one can be attached to a post. Call this before attaching an image so you use a real filename.",
      {},
      async () => {
        const images = listImages();
        if (!images.length) {
          return ok(
            `No images available. The user drops images into ${imagesFolder()} for you to use.`
          );
        }
        const listing = images
          .map((i) => `${i.fileName} (${(i.sizeBytes / 1024).toFixed(0)} KB, added ${i.modifiedAt})`)
          .join("\n");
        return ok(`Available images in ${imagesFolder()}:\n${listing}`);
      }
    ),
    tool(
      "post_to_x",
      "Publish a post to the connected X (Twitter) account, optionally with one image. Use only when the user has asked for something to be posted publicly. " +
        "Posts containing links may have materially different platform billing, so avoid links unless essential. " +
        "If a link is not essential to the post, leave it out and offer to add it as a reply instead. " +
        "Never post the same text twice; X rejects duplicates and the attempt is still billed.",
      {
        text: z
          .string()
          .max(280)
          .describe(
            "The post body. Max 280 characters. Avoid including a URL unless necessary."
          ),
        imageFile: z
          .string()
          .optional()
          .describe(
            "Optional filename of an image from the Jarvis images folder, as returned by list_available_images. Plain filename only."
          ),
      },
      async (args) => guarded("x", "post_to_x", connectionId, async () => {
        const url = "https://api.x.com/2/tweets";

        let mediaId: string | null = null;
        if (args.imageFile) {
          try {
            mediaId = await uploadImageToX(creds, args.imageFile);
          } catch (err) {
            // Fail rather than silently posting without the image the user expected.
            return fail(err instanceof Error ? err.message : String(err));
          }
        }
        const header = oauth1Header("POST", url, {
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
          accessToken: creds.accessToken,
          accessTokenSecret: creds.accessTokenSecret,
        });
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: header, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: args.text,
            ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await res.text();

        // X bills per post and stops at zero rather than overdrawing. Without
        // naming the cause this surfaces as a bare 402 that looks like a bug.
        if (res.status === 402) {
          return fail(
            "X rejected the post: your API credits are depleted. Buy credits in the X " +
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
          const withImage = mediaId ? ` with image ${args.imageFile}` : "";
          // Returned as data as well as prose. The prose is for the model; the
          // field is what gets stored, and without it the post is unmeasurable.
          return {
            ...ok(`Posted to X${withImage}. Post id: ${parsed.data?.id ?? "unknown"}`),
            externalPostId: parsed.data?.id ?? null,
          };
        } catch {
          return ok("Posted to X.");
        }
      }, args.text, sessionId)
    ),
  ]);
}

function buildSlackTools(creds: Creds, sessionId?: string, connectionId?: string): AnyTool[] {
  return erase([
    tool(
      "post_to_slack",
      "Send a message to a Slack channel in the connected workspace.",
      {
        channel: z.string().describe("Channel name (e.g. #general) or channel ID."),
        text: z.string().describe("Message body. Slack markdown is supported."),
      },
      async (args) => guarded("slack", "post_to_slack", connectionId, async () => {
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
      }, args.text, sessionId)
    ),
  ]);
}

function buildDiscordTools(creds: Creds, sessionId?: string, connectionId?: string): AnyTool[] {
  return erase([
    tool(
      "post_to_discord",
      "Send a message to a Discord channel the bot has access to.",
      {
        channelId: z.string().describe("Numeric Discord channel ID."),
        text: z.string().describe("Message body."),
      },
      async (args) => guarded("discord", "post_to_discord", connectionId, async () => {
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
      }, args.text, sessionId)
    ),
  ]);
}

function buildResendTools(creds: Creds, sessionId?: string, connectionId?: string): AnyTool[] {
  return erase([
    tool(
      "send_email",
      "Send an email from the connected sending domain.",
      {
        to: z.string().describe("Recipient email address."),
        subject: z.string().describe("Subject line."),
        body: z.string().describe("Plain-text email body."),
      },
      async (args) => guarded("resend", "send_email", connectionId, async () => {
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
      }, undefined, sessionId)
    ),
  ]);
}

const BUILDERS: Record<string, (creds: Creds, sessionId?: string, connectionId?: string) => AnyTool[]> = {
  x: buildXTools,
  slack: buildSlackTools,
  discord: buildDiscordTools,
  resend: buildResendTools,
};

export interface PlatformToolset {
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  /** Plain-English list of what's available, for the system prompt. */
  capabilitySummary: string;
  /**
   * Read-only tools that are pre-approved. The approval gate exists to stop
   * things leaving the machine; making someone confirm a local folder listing is
   * friction that teaches them to click approve without reading.
   */
  autoAllowTools: string[];
}

/** Local and read-only — nothing here sends, spends, or publishes. */
const READ_ONLY_TOOLS = ["mcp__jarvis__list_available_images"];

/**
 * Builds tools for platforms that are connected AND passed their last test.
 * Exposing tools for a broken connection just invites confident failures.
 */
/**
 * Which accounts a session may act as.
 *
 * `connectionId` pins it to exactly one — used by publication runs, where the
 * campaign has already decided the account and the model must have no other
 * option. `agentId` narrows to that agent's accounts plus the shared pool.
 * Neither is a filter the model can talk its way past: a tool that was never
 * built cannot be called.
 */
export interface ToolsetScope {
  agentId?: string | null;
  connectionId?: string | null;
}

export function buildPlatformToolset(
  sessionId?: string,
  scope: ToolsetScope = {}
): PlatformToolset {
  const tools: AnyTool[] = [];
  const names: string[] = [];

  const available = scope.connectionId
    ? listConnections().filter((connection) => connection.id === scope.connectionId)
    : listConnections(scope.agentId ?? undefined);

  for (const connection of available) {
    if (connection.status !== "connected") continue;
    const builder = BUILDERS[connection.platformId];
    const creds = getConnectionCredentialsById(connection.id);
    if (!builder || !creds) continue;
    tools.push(...builder(creds, sessionId, connection.id));
    const platformName = getPlatform(connection.platformId)?.definition.name ?? connection.platformId;
    names.push(connection.label ? `${platformName} (${connection.label})` : platformName);
  }

  if (!tools.length) {
    return {
      capabilitySummary:
        "No external platforms are connected yet, so you cannot post or send anything. If asked to, explain that the platform needs connecting on the Connections page first.",
      autoAllowTools: [],
    };
  }

  return {
    mcpServers: {
      jarvis: createSdkMcpServer({ name: "jarvis", version: "1.0.0", tools }),
    },
    capabilitySummary: `Connected platforms you can act on: ${names.join(", ")}. Use the provided tools to post or send. Every outbound action requires the user's approval before it goes out, so draft carefully — assume what you send is final. To attach an image, call list_available_images first and use one of the filenames it returns.`,
    autoAllowTools: READ_ONLY_TOOLS,
  };
}
