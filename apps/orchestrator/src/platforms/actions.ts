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
import { drawFromWallet } from "../billing/walletFunding.js";

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

/**
 * Slack retired the old single-request `files.upload` on 2025-11-12. The
 * replacement is three calls: reserve an upload slot, PUT the raw bytes to
 * the URL it hands back, then complete the upload — which is also where the
 * channel and caption are attached, so a successful upload always ends up
 * posted rather than left as an orphaned file only the uploader can see.
 */
export async function uploadImageToSlack(
  creds: Creds,
  fileName: string,
  channelId: string,
  comment: string
): Promise<void> {
  const { bytes, path } = readImage(fileName);

  const urlForm = new FormData();
  urlForm.append("filename", basename(path));
  urlForm.append("length", String(bytes.length));
  const urlRes = await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.botToken}` },
    body: urlForm,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const urlData = (await urlRes.json()) as {
    ok?: boolean;
    error?: string;
    upload_url?: string;
    file_id?: string;
  };
  if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
    throw new Error(`Slack refused the upload request: ${urlData.error ?? "unknown error"}`);
  }

  const putRes = await fetch(urlData.upload_url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!putRes.ok) {
    throw new Error(`Slack rejected the image bytes (HTTP ${putRes.status}).`);
  }

  const completeForm = new FormData();
  completeForm.append("files", JSON.stringify([{ id: urlData.file_id, title: fileName }]));
  completeForm.append("channel_id", channelId);
  completeForm.append("initial_comment", comment);
  const completeRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.botToken}` },
    body: completeForm,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const completeData = (await completeRes.json()) as { ok?: boolean; error?: string };
  if (!completeData.ok) {
    throw new Error(`Slack refused to complete the upload: ${completeData.error ?? "unknown error"}`);
  }
}

function buildSlackTools(creds: Creds, sessionId?: string, connectionId?: string): AnyTool[] {
  return erase([
    tool(
      "post_to_slack",
      "Send a message to a Slack channel in the connected workspace, optionally with one image.",
      {
        channel: z
          .string()
          .describe(
            "Channel name (e.g. #general) or channel ID for a text-only message. " +
              "Attaching an image requires the actual channel ID (e.g. C0123AB4CDE) — Slack's " +
              "upload API does not accept a #name there."
          ),
        text: z.string().describe("Message body. Slack markdown is supported."),
        imageFile: z
          .string()
          .optional()
          .describe(
            "Optional filename of an image from the Jarvis images folder, as returned by list_available_images. " +
              "Plain filename only. Requires channel to be a channel ID, not a #name."
          ),
      },
      async (args) => guarded("slack", "post_to_slack", connectionId, async () => {
        if (args.imageFile) {
          try {
            await uploadImageToSlack(creds, args.imageFile, args.channel, args.text);
          } catch (err) {
            // Fail rather than silently posting the text without the image the user expected.
            return fail(err instanceof Error ? err.message : String(err));
          }
          return ok(`Message with image ${args.imageFile} sent to ${args.channel}.`);
        }

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

/** A `files[0]` + `payload_json` multipart body is Discord's own documented shape for an attachment on message create. */
export async function sendDiscordMessage(
  creds: Creds,
  channelId: string,
  text: string,
  imageFile?: string
): Promise<Response> {
  const url = `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`;
  if (!imageFile) {
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bot ${creds.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  const { bytes, path } = readImage(imageFile);
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: text }));
  form.append("files[0]", new Blob([new Uint8Array(bytes)], { type: mimeTypeFor(path) }), basename(path));
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bot ${creds.botToken}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function buildDiscordTools(creds: Creds, sessionId?: string, connectionId?: string): AnyTool[] {
  return erase([
    tool(
      "post_to_discord",
      "Send a message to a Discord channel the bot has access to, optionally with one image.",
      {
        channelId: z.string().describe("Numeric Discord channel ID."),
        text: z.string().describe("Message body."),
        imageFile: z
          .string()
          .optional()
          .describe(
            "Optional filename of an image from the Jarvis images folder, as returned by list_available_images. Plain filename only."
          ),
      },
      async (args) => guarded("discord", "post_to_discord", connectionId, async () => {
        let res: Response;
        try {
          res = await sendDiscordMessage(creds, args.channelId, args.text, args.imageFile);
        } catch (err) {
          // readImage throws for a bad filename before any request is sent.
          return fail(err instanceof Error ? err.message : String(err));
        }
        if (!res.ok) {
          return fail(`Discord refused the message (HTTP ${res.status}): ${await res.text()}`);
        }
        const withImage = args.imageFile ? ` with image ${args.imageFile}` : "";
        return ok(`Message sent to Discord channel ${args.channelId}${withImage}.`);
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

/**
 * The wallet, as something Jarvis can actually reach.
 *
 * Only ever a draw-down. Coinbase's spend permission moves tokens from the
 * operator's wallet to Jarvis's own spender account and takes no recipient, so
 * this tool structurally cannot send money to a third party however it is
 * asked. That is the property worth keeping: the worst a confused or
 * manipulated model can do here is move the operator's own money into the
 * operator's own agent account, inside a limit they signed.
 *
 * Three separate ceilings, none of which this code can raise: the daily
 * envelope under Money (checked first, so a refusal costs no gas), the
 * on-chain allowance, and the approval gate every non-read tool passes
 * through.
 */
function buildWalletTools(_creds: Creds, _sessionId?: string, _connectionId?: string): AnyTool[] {
  return erase([
    tool(
      "draw_usdc_from_wallet",
      "Draw USDC from the operator's Coinbase wallet into Jarvis's own spender account, within the spend permission they granted. " +
        "This does NOT pay anyone — it moves the operator's money into your account so it is available. There is no way to send it onward from here. " +
        "Use it only when the operator has asked you to fund something, and say plainly what the money is for.",
      {
        purposeLabel: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "What this is for, in the operator's terms — it appears in the ledger they read. E.g. 'Anthropic Console top-up'."
          ),
        amountUsdc: z
          .number()
          .positive()
          .max(10_000)
          .describe("Amount in USDC, as a decimal number of dollars. E.g. 12.5 for $12.50."),
      },
      async (args) => {
        // Rounded to the token's six decimals here rather than left to the
        // caller: a model writing minor units gets $12.50 wrong by a factor of
        // a million about as often as it gets it right.
        const amountMinor = Math.round(args.amountUsdc * 1_000_000);
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
          return fail("That amount could not be read as a USDC value.");
        }
        try {
          const spend = await drawFromWallet({
            purposeLabel: args.purposeLabel.trim(),
            amountMinor,
          });
          return ok(
            `Drew ${(spend.amountMinor / 1_000_000).toFixed(2)} USDC for "${spend.purposeLabel}". ` +
              `Transaction ${spend.txHash ?? "pending"}. It is in Jarvis's spender account and recorded in the shared ledger.`
          );
        } catch (err) {
          // Surfaced verbatim: these messages are the envelope and the
          // permission explaining themselves, and are what the operator needs
          // to hear rather than a generic failure.
          return fail(err instanceof Error ? err.message : String(err));
        }
      }
    ),
  ]);
}


const BUILDERS: Record<string, (creds: Creds, sessionId?: string, connectionId?: string) => AnyTool[]> = {
  x: buildXTools,
  slack: buildSlackTools,
  discord: buildDiscordTools,
  resend: buildResendTools,
  coinbase: buildWalletTools,
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
