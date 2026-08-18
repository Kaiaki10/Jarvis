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
    tagline: "Receive and answer customer email from your own domain.",
    category: "email",
    docsUrl: "https://resend.com/api-keys",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        help: "Starts with re_. Sending access is enough for outbound-only use; inbound email also needs permission to retrieve received messages.",
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
      {
        key: "webhookSecret",
        label: "Inbound webhook secret",
        help: "Optional until receiving is enabled. Copy the whsec_ signing secret from the Resend webhook details page.",
        expectedPrefix: "whsec_",
        placeholder: "whsec_…",
        secret: true,
        optional: true,
      },
      {
        key: "inboundAddress",
        label: "Inbound support address",
        help: "Optional receiving address or subdomain mailbox that customers reply to.",
        placeholder: "support@inbound.example.com",
        secret: false,
        optional: true,
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
          "Open API Keys → Create API Key. Choose Sending access for outbound-only use, or Full access when Jarvis will retrieve received email.",
          "Copy the key immediately; Resend shows it once.",
        ],
        linkUrl: "https://resend.com/api-keys",
        linkLabel: "Open Resend API keys",
        warning:
          "A sending-only key cannot read your domain list, so the connection test confirms the key authenticates rather than listing domains. That is expected and not a failure.",
      },
      {
        title: "Enable inbound email (optional)",
        body: [
          "In Resend configure a receiving domain or address, then add an email.received webhook pointing to your public /webhooks/resend URL.",
          "Copy the webhook's whsec_ signing secret below. Jarvis verifies it before retrieving or storing the message body.",
        ],
        linkUrl: "https://resend.com/webhooks",
        linkLabel: "Open Resend webhooks",
        warning: "Resend cannot call localhost. Use a public HTTPS callback that exposes only Jarvis webhook routes.",
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
    tagline: "Publish posts and answer X direct messages.",
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
          "For inbound direct messages, enable Account Activity API access and register your public /webhooks/x URL in the X developer console.",
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

function metaPlatform(input: { id: "facebook" | "instagram"; name: string; accountLabel: string }): Platform {
  return {
    definition: {
      id: input.id,
      name: input.name,
      tagline: `Receive and answer ${input.name} customer messages.`,
      category: "messaging",
      docsUrl: "https://developers.facebook.com/apps/",
      fields: [
        { key: "accessToken", label: `${input.accountLabel} access token`, help: "Long-lived token with messaging permissions.", secret: true },
        { key: "accountId", label: `${input.accountLabel} ID`, help: "Numeric Page or Instagram professional account ID.", secret: false },
        { key: "appSecret", label: "Meta app secret", help: "Used only to verify X-Hub-Signature-256 webhook requests.", secret: true },
        { key: "verifyToken", label: "Webhook verify token", help: "A private string you also enter in the Meta App Dashboard callback configuration.", secret: true },
      ],
      steps: [
        {
          title: "Configure the Meta app",
          body: [
            `Connect the ${input.accountLabel.toLowerCase()} to a Meta developer app and enable messaging.`,
            "Grant the messaging permissions required by the account and generate a long-lived access token.",
          ],
          linkUrl: "https://developers.facebook.com/apps/",
          linkLabel: "Open Meta apps",
        },
        {
          title: "Configure the webhook",
          body: [
            `Use /webhooks/${input.id} on your publicly reachable Jarvis orchestrator URL.`,
            "Enter the same verify token below in Meta, then subscribe to messages and messaging_postbacks.",
          ],
          warning: "Meta cannot call localhost. The orchestrator must be behind a public HTTPS URL before live messages can arrive.",
        },
      ],
    },
    async test(creds) {
      const { status, body } = await fetchJson(`https://graph.facebook.com/v24.0/${encodeURIComponent(creds.accountId)}?fields=name,username`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (status !== 200) return failure(`${input.name} rejected the account credentials (HTTP ${status}).`);
      const data = body as { name?: string; username?: string };
      return { ok: true, detail: `Connected as ${data.username ? `@${data.username}` : data.name ?? input.name}` };
    },
  };
}

const facebook = metaPlatform({ id: "facebook", name: "Facebook Messenger", accountLabel: "Page" });
const instagram = metaPlatform({ id: "instagram", name: "Instagram Messaging", accountLabel: "Instagram account" });

const googleAds: Platform = {
  definition: {
    id: "google_ads",
    name: "Google Ads",
    tagline: "Measure and manage approved Search, Display, and Performance Max budgets.",
    category: "advertising",
    docsUrl: "https://developers.google.com/google-ads/api/docs/get-started/introduction",
    fields: [
      { key: "developerToken", label: "Developer token", help: "From API Center in a Google Ads manager account.", secret: true },
      { key: "clientId", label: "OAuth client ID", help: "OAuth 2.0 client ID from the Google Cloud project.", secret: true },
      { key: "clientSecret", label: "OAuth client secret", help: "OAuth 2.0 client secret from the same project.", secret: true },
      { key: "refreshToken", label: "OAuth refresh token", help: "Long-lived refresh token for a user with access to the advertiser account.", secret: true },
      { key: "customerId", label: "Advertiser customer ID", help: "The 10-digit client customer ID, without hyphens.", secret: false },
      { key: "loginCustomerId", label: "Manager customer ID", help: "Required when access goes through a manager account; omit for direct advertiser access.", secret: false, optional: true },
    ],
    capabilities: ["Cumulative performance", "Conversion value", "ROAS decisioning"],
    dataFreshness: "On-demand + 15-minute active sync",
    steps: [
      {
        title: "Enable Google Ads API access",
        body: [
          "Create or choose a Google Cloud project, enable the Google Ads API, and create OAuth 2.0 credentials.",
          "In the Google Ads manager account, open API Center and request a developer token. Test-account access is sufficient for rehearsal.",
        ],
        linkUrl: "https://developers.google.com/google-ads/api/docs/get-started/dev-token",
        linkLabel: "Open Google Ads API setup",
      },
      {
        title: "Authorize the advertiser",
        body: [
          "Generate a refresh token for a user who can access the target advertiser account.",
          "Enter customer IDs without hyphens. Add the manager customer ID only when the advertiser is reached through that manager.",
        ],
        warning: "The Google Ads OAuth scope is restricted. Complete Google verification before using this outside your own accounts.",
      },
    ],
  },
  async test(creds) {
    const token = await fetchJson("https://www.googleapis.com/oauth2/v3/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
      }).toString(),
    });
    const accessToken = (token.body as { access_token?: string })?.access_token;
    if (token.status !== 200 || !accessToken) return failure("Google rejected the OAuth credentials or refresh token.");
    const customerId = creds.customerId.replace(/-/g, "");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": creds.developerToken,
      "Content-Type": "application/json",
    };
    if (creds.loginCustomerId) headers["login-customer-id"] = creds.loginCustomerId.replace(/-/g, "");
    const result = await fetchJson(`https://googleads.googleapis.com/v25/customers/${encodeURIComponent(customerId)}/googleAds:search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: "SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1" }),
    });
    if (result.status !== 200) return failure(`Google Ads rejected account access (HTTP ${result.status}).`);
    const row = (result.body as { results?: Array<{ customer?: { descriptiveName?: string; id?: string; currencyCode?: string } }> })?.results?.[0]?.customer;
    return { ok: true, detail: `Connected to ${row?.descriptiveName ?? row?.id ?? customerId}${row?.currencyCode ? ` (${row.currencyCode})` : ""}` };
  },
};

const metaAds: Platform = {
  definition: {
    id: "meta_ads",
    name: "Meta Ads",
    tagline: "Measure and manage approved Facebook and Instagram advertising budgets.",
    category: "advertising",
    docsUrl: "https://developers.facebook.com/docs/marketing-apis/",
    fields: [
      { key: "accessToken", label: "Marketing API access token", help: "Long-lived user or system-user token with ads_read and ads_management.", secret: true },
      { key: "adAccountId", label: "Ad account ID", help: "The numeric ad account ID; the act_ prefix is optional.", secret: false },
    ],
    capabilities: ["Campaign insights", "Purchase attribution", "Cross-channel reporting"],
    dataFreshness: "On-demand + 15-minute active sync",
    steps: [
      {
        title: "Enable the Marketing API",
        body: [
          "Create a Meta app, add the Marketing API product, and connect it to the Business account.",
          "Grant the system user access to the ad account and generate a long-lived token with ads_read and ads_management.",
        ],
        linkUrl: "https://developers.facebook.com/apps/",
        linkLabel: "Open Meta apps",
      },
      {
        title: "Choose the ad account",
        body: ["Copy the numeric ad account ID from Ads Manager. Jarvis accepts it with or without the act_ prefix."],
        warning: "Keep new campaigns paused until creative, targeting, conversion tracking, and the first budget have all been reviewed.",
      },
    ],
  },
  async test(creds) {
    const accountId = creds.adAccountId.replace(/^act_/, "");
    const { status, body } = await fetchJson(
      `https://graph.facebook.com/v24.0/act_${encodeURIComponent(accountId)}?fields=name,account_status,currency`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` } }
    );
    if (status !== 200) return failure(`Meta Ads rejected account access (HTTP ${status}).`);
    const data = body as { name?: string; currency?: string };
    return { ok: true, detail: `Connected to ${data.name ?? `act_${accountId}`} (${data.currency ?? "currency unknown"})` };
  },
};

const xAds: Platform = {
  definition: {
    id: "x_ads",
    name: "X Ads",
    tagline: "Measure and manage approved X advertising campaigns and funding limits.",
    category: "advertising",
    docsUrl: "https://docs.x.com/x-ads-api",
    fields: [
      { key: "apiKey", label: "API Key", help: "From an X developer app approved for Ads API access.", secret: true },
      { key: "apiSecret", label: "API Key Secret", help: "Shown with the API key.", secret: true },
      { key: "accessToken", label: "Access Token", help: "Token for a user with access to the ads account.", secret: true },
      { key: "accessTokenSecret", label: "Access Token Secret", help: "Shown alongside the access token.", secret: true },
      { key: "accountId", label: "Ads account ID", help: "The X Ads account identifier.", secret: false },
      { key: "fundingInstrumentId", label: "Funding instrument ID", help: "Existing funding instrument from ads.x.com; X does not create this through the API.", secret: false },
    ],
    capabilities: ["Seven-day live analytics", "Conversion signals", "Funding guardrails"],
    dataFreshness: "15-minute complete-hour sync",
    steps: [
      {
        title: "Obtain Ads API access",
        body: [
          "Use an approved X developer account and an app approved for Ads API access.",
          "Generate OAuth 1.0a keys and user tokens for someone with permission on the ads account.",
        ],
        linkUrl: "https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests",
        linkLabel: "Open X Ads authentication guide",
      },
      {
        title: "Confirm funding",
        body: ["Choose an existing funding instrument from the ads account and enter its ID below."],
        warning: "Funding instruments must already exist in ads.x.com or through an X account manager; the Ads API cannot create them.",
      },
    ],
  },
  async test(creds) {
    const url = `https://ads-api.x.com/12/accounts/${encodeURIComponent(creds.accountId)}`;
    const header = oauth1Header("GET", url, {
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      accessToken: creds.accessToken,
      accessTokenSecret: creds.accessTokenSecret,
    });
    const { status, body } = await fetchJson(url, { headers: { Authorization: header } });
    if (status !== 200) return failure(`X Ads rejected account access (HTTP ${status}).`);
    const data = body as { data?: { name?: string; id?: string; currency?: string } };
    return { ok: true, detail: `Connected to ${data.data?.name ?? data.data?.id ?? creds.accountId}${data.data?.currency ? ` (${data.data.currency})` : ""}` };
  },
};

export const PLATFORMS: Platform[] = [x, facebook, instagram, slack, discord, resend, googleAds, metaAds, xAds];

export function getPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.definition.id === id);
}

export function platformDefinitions(): PlatformDefinition[] {
  return PLATFORMS.map((p) => p.definition);
}
