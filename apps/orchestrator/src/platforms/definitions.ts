import type { PlatformDefinition, TestConnectionResult } from "@jarvis/shared";
import { oauth1Header } from "./oauth1.js";

type Creds = Record<string, string>;

export interface Platform {
  definition: PlatformDefinition;
  /** Proves the credentials actually work, rather than just that they're stored. */
  test: (creds: Creds) => Promise<TestConnectionResult>;
}

const TIMEOUT_MS = 15_000;

async function fetchJson(
  url: string,
  init: RequestInit
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function failure(message: string): TestConnectionResult {
  return { ok: false, message };
}

const slack: Platform = {
  definition: {
    id: "slack",
    name: "Slack",
    tagline: "Post updates and route customer messages through a workspace.",
    category: "messaging",
    docsUrl: "https://api.slack.com/apps",
    fields: [
      {
        key: "botToken",
        label: "Bot User OAuth Token",
        help: "Starts with xoxb-. Found under OAuth & Permissions after you install the app to your workspace.",
        expectedPrefix: "xoxb-",
        placeholder: "xoxb-…",
        secret: true,
      },
    ],
    steps: [
      {
        title: "Create a Slack app",
        body: [
          "Open Slack's app dashboard and choose Create New App → From scratch.",
          "Give it a name (Jarvis works) and pick the workspace you want it to act in.",
        ],
        linkUrl: "https://api.slack.com/apps",
        linkLabel: "Open Slack app dashboard",
      },
      {
        title: "Add permissions",
        body: [
          "In the sidebar choose OAuth & Permissions, scroll to Scopes, and add the Bot Token Scopes you need.",
          "chat:write lets Jarvis post messages. Add channels:read if you want it to list channels, and users:read to look up people.",
        ],
        warning:
          "Scopes must be added before installing. If you install first and add scopes later, you have to reinstall the app.",
      },
      {
        title: "Install and copy the token",
        body: [
          "Still under OAuth & Permissions, click Install to Workspace and approve.",
          "Copy the Bot User OAuth Token that appears — it begins with xoxb-.",
        ],
      },
    ],
  },
  async test(creds) {
    const { status, body } = await fetchJson("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.botToken}` },
    });
    const data = body as { ok?: boolean; error?: string; team?: string; user?: string };
    if (status !== 200) return failure(`Slack returned HTTP ${status}.`);
    if (!data?.ok) return failure(`Slack rejected the token: ${data?.error ?? "unknown error"}`);
    return { ok: true, detail: `Connected to ${data.team} as ${data.user}` };
  },
};

const discord: Platform = {
  definition: {
    id: "discord",
    name: "Discord",
    tagline: "Run a community server or support channel with a bot account.",
    category: "messaging",
    docsUrl: "https://discord.com/developers/applications",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        help: "From your application's Bot tab. Shown only once when you reset it, so copy it immediately.",
        placeholder: "MTIz…",
        secret: true,
      },
    ],
    steps: [
      {
        title: "Create an application",
        body: [
          "Go to the Discord developer portal and click New Application.",
          "Name it, then open the Bot tab in the sidebar.",
        ],
        linkUrl: "https://discord.com/developers/applications",
        linkLabel: "Open Discord developer portal",
      },
      {
        title: "Get the bot token",
        body: [
          "On the Bot tab click Reset Token, confirm, then copy the value it shows you.",
        ],
        warning:
          "Discord shows the token exactly once. If you navigate away without copying it, reset it again.",
      },
      {
        title: "Invite the bot to your server",
        body: [
          "Open OAuth2 → URL Generator, tick the bot scope, choose the permissions it needs (Send Messages at minimum), then open the generated URL and pick your server.",
          "The bot has to be in the server before it can post there.",
        ],
      },
    ],
  },
  async test(creds) {
    const { status, body } = await fetchJson("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${creds.botToken}` },
    });
    if (status === 401) return failure("Discord rejected the token (401 Unauthorized).");
    if (status !== 200) return failure(`Discord returned HTTP ${status}.`);
    const data = body as { username?: string; discriminator?: string };
    return { ok: true, detail: `Connected as ${data.username ?? "bot"}` };
  },
};

/**
 * Resend only sends from a domain you have verified by DNS, so a consumer mailbox
 * can never be a valid sender no matter how good the API key is. Catching it here
 * turns a confusing bounce at send time into a clear message at setup time.
 */
const CONSUMER_MAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
];

function consumerDomainWarning(fromAddress: string): string | null {
  const domain = fromAddress.split("@")[1]?.toLowerCase().trim();
  if (!domain || !CONSUMER_MAIL_DOMAINS.includes(domain)) return null;
  return `The API key works, but "${fromAddress}" cannot be used as the sender: Resend requires a domain you have verified by DNS, and ${domain} is not one you control. Use an address on your own domain, or onboarding@resend.dev for testing.`;
}

const resend: Platform = {
  definition: {
    id: "resend",
    name: "Resend",
    tagline: "Send customer emails and replies from your own domain.",
    category: "email",
    docsUrl: "https://resend.com/api-keys",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        help: "Starts with re_. A key with Sending access is all Jarvis needs — it does not require full access.",
        expectedPrefix: "re_",
        placeholder: "re_…",
        secret: true,
      },
      {
        key: "fromAddress",
        label: "From address",
        help: "Use onboarding@resend.dev to start — it needs no domain and no DNS, and can send to your own Resend account address. Switch to an address on a domain you have verified once you want mail to come from your business.",
        placeholder: "onboarding@resend.dev",
        secret: false,
      },
    ],
    steps: [
      {
        title: "Verify your sending domain",
        body: [
          "In Resend open Domains → Add Domain and follow the DNS records it gives you.",
          "Until a domain is verified you can only send to your own address, which is fine for testing.",
        ],
        linkUrl: "https://resend.com/domains",
        linkLabel: "Open Resend domains",
      },
      {
        title: "Create an API key",
        body: [
          "Open API Keys → Create API Key. Choose Sending access — that is all Jarvis needs.",
          "Copy the key immediately; Resend shows it once.",
        ],
        linkUrl: "https://resend.com/api-keys",
        linkLabel: "Open Resend API keys",
        warning:
          "A sending-only key cannot read your domain list, so the connection test confirms the key authenticates rather than listing domains. That is expected and not a failure.",
      },
    ],
  },
  async test(creds) {
    const { status, body } = await fetchJson("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${creds.apiKey}` },
    });
    const data = body as { name?: string; message?: string } | null;

    // Check the sender before reporting success — a valid key with an unusable
    // from-address still cannot deliver a single email.
    const senderProblem = consumerDomainWarning(creds.fromAddress);

    // A sending-only key is the right key for this integration, but it cannot read
    // /domains. Resend distinguishes "valid key, wrong scope" (restricted_api_key)
    // from a bad key, and the former is itself proof that authentication worked —
    // so treat it as success rather than telling the user their key is broken.
    if (data?.name === "restricted_api_key") {
      return senderProblem
        ? failure(senderProblem)
        : {
            ok: true,
            detail: `Sending-only key accepted — sending as ${creds.fromAddress}`,
          };
    }
    if (status === 401 || status === 403) {
      return failure(
        `Resend rejected the API key: ${data?.message ?? "unauthorized"}. Check it was copied in full.`
      );
    }
    if (status !== 200) {
      // Echo what Resend actually said — a bare status code gives the user
      // nothing to act on, which is how a malformed key looks like a mystery.
      const detail = data?.message ?? data?.name ?? JSON.stringify(body);
      return failure(`Resend returned HTTP ${status}: ${detail}`);
    }
    if (senderProblem) return failure(senderProblem);
    return { ok: true, detail: `Key valid — sending as ${creds.fromAddress}` };
  },
};

const x: Platform = {
  definition: {
    id: "x",
    name: "X (Twitter)",
    tagline: "Draft and publish posts to an X account.",
    category: "social",
    docsUrl: "https://developer.x.com/en/portal/dashboard",
    fields: [
      { key: "apiKey", label: "API Key", help: "Also labelled Consumer Key.", secret: true },
      {
        key: "apiSecret",
        label: "API Key Secret",
        help: "Also labelled Consumer Secret.",
        secret: true,
      },
      {
        key: "accessToken",
        label: "Access Token",
        help: "The user-context token for the account that will post.",
        secret: true,
      },
      {
        key: "accessTokenSecret",
        label: "Access Token Secret",
        help: "Shown alongside the access token.",
        secret: true,
      },
    ],
    steps: [
      {
        title: "Create a developer project",
        body: [
          "Sign in to the X developer portal and create a Project, then an App inside it.",
          "The Free tier allows posting but has a low monthly cap, so treat it as a trial.",
        ],
        linkUrl: "https://developer.x.com/en/portal/dashboard",
        linkLabel: "Open X developer portal",
      },
      {
        title: "Turn on user authentication",
        body: [
          "In your app open Settings → User authentication settings → Set up.",
          "Set App permissions to Read and write, and Type of App to Automated App or Bot.",
          "X then demands a Callback URI and a Website URL before it will save. Jarvis never uses either — it signs each request with tokens you generate by hand, so no browser redirect ever happens.",
          "Use https://example.com/callback and https://example.com. X rejects localhost with 'Only valid HTTP(S) urls are allowed', and example.com is the reserved placeholder domain, so it is a valid HTTPS URL that belongs to nobody. Any HTTPS URL you own works too.",
        ],
        linkUrl: "https://developer.x.com/en/portal/dashboard",
        linkLabel: "Open X developer portal",
      },
      {
        title: "Generate keys and tokens — in this order",
        body: [
          "Open the Keys and tokens tab. Copy the API Key and API Key Secret.",
          "Then generate the Access Token and Secret, and paste all four below.",
          "Under the access token X should say 'Read and Write'. If it says 'Read', the permission change came too late — regenerate the token.",
        ],
        warning:
          "Access tokens permanently carry whatever permission the app had at the moment they were created. If you already generated tokens before switching to Read and write, they can read but never post, and the connection test still passes because reading works. Regenerate them after changing permissions, then re-enter them here.",
      },
    ],
  },
  async test(creds) {
    const url = "https://api.x.com/2/users/me";
    const header = oauth1Header("GET", url, {
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      accessToken: creds.accessToken,
      accessTokenSecret: creds.accessTokenSecret,
    });
    const { status, body } = await fetchJson(url, { headers: { Authorization: header } });
    if (status === 401) {
      return failure("X rejected the credentials (401). Check all four values are correct.");
    }
    if (status === 403) {
      return failure(
        "X accepted the credentials but refused the request (403). Usually means app permissions are read-only — set Read and write, then regenerate your access tokens."
      );
    }
    if (status !== 200) return failure(`X returned HTTP ${status}.`);
    const data = body as { data?: { username?: string } };
    return { ok: true, detail: `Connected as @${data?.data?.username ?? "unknown"}` };
  },
};

export const PLATFORMS: Platform[] = [x, slack, discord, resend];

export function getPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.definition.id === id);
}

export function platformDefinitions(): PlatformDefinition[] {
  return PLATFORMS.map((p) => p.definition);
}
