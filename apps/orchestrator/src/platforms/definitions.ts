import Stripe from "stripe";
import { CdpClient } from "@coinbase/cdp-sdk";
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
    tagline: "Talk to any Jarvis agent from Slack while Jarvis stays local.",
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
      {
        key: "appToken",
        label: "Socket Mode App Token",
        help: "Starts with xapp-. Create it under Basic Information → App-Level Tokens with connections:write.",
        expectedPrefix: "xapp-",
        placeholder: "xapp-…",
        secret: true,
      },
      {
        key: "allowedUserIds",
        label: "Allowed Slack user IDs",
        help: "Comma-separated list of Slack user IDs allowed to operate your agents (for example U012ABCDEF, find yours under your Slack profile → More → Copy member ID). Required — anyone else in the workspace could otherwise chat with your agents and read local files through them.",
        placeholder: "U012ABCDEF, U045GHIJKL",
        secret: false,
      },
    ],
    capabilities: ["Agent conversations", "Thread continuity", "Local-only Socket Mode"],
    dataFreshness: "Real-time while the local orchestrator is running",
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
        title: "Enable Socket Mode",
        body: [
          "Open Socket Mode in the app sidebar and turn it on.",
          "When Slack asks for an app-level token, name it Jarvis Socket and give it connections:write. Copy the xapp- token below.",
        ],
      },
      {
        title: "Subscribe to messages",
        body: [
          "Under OAuth & Permissions add bot scopes chat:write, app_mentions:read, and im:history.",
          "Under Event Subscriptions enable events, then subscribe to app_mention and message.im.",
          "Under App Home keep the Messages tab enabled and allow users to send messages so direct messages reach Jarvis.",
        ],
        warning: "After changing scopes, reinstall the app to the workspace so the new permissions take effect.",
      },
      {
        title: "Install and connect",
        body: [
          "Still under OAuth & Permissions, click Install to Workspace and approve.",
          "Copy the xoxb- Bot User OAuth Token below. In Slack, open your profile → More → Copy member ID and paste it into Allowed Slack user IDs, then save and test.",
          "Invite the app to any channel where you want to mention it. In Slack, mention the bot normally, send `agents` to list choices, or write `Agent Name: your message`. Direct messages work too.",
        ],
        warning: "The allowlist is required — without it, anyone in the workspace could chat with your agents and read local files through them.",
      },
    ],
  },
  async test(creds) {
    const [bot, socket] = await Promise.all([
      fetchJson("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.botToken}` },
      }),
      fetchJson("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.appToken}` },
      }),
    ]);
    const botData = bot.body as { ok?: boolean; error?: string; team?: string; user?: string };
    const socketData = socket.body as { ok?: boolean; error?: string; url?: string };
    if (bot.status !== 200) return failure(`Slack bot authentication returned HTTP ${bot.status}.`);
    if (!botData?.ok) return failure(`Slack rejected the bot token: ${botData?.error ?? "unknown error"}`);
    if (socket.status !== 200) return failure(`Slack Socket Mode returned HTTP ${socket.status}.`);
    if (!socketData?.ok || !socketData.url) return failure(`Slack rejected the app token: ${socketData?.error ?? "unknown error"}`);
    return { ok: true, detail: `Connected to ${botData.team} as ${botData.user}; real-time agent chat is ready` };
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
    // The account-creation steps below are guided, not automated: Jarvis
    // never touches X's own signup form (CAPTCHA/human-verification is
    // squarely X's defense against exactly that), and only ever detects and
    // surfaces the confirmation email that follows — never clicks it unless
    // the operator explicitly turns auto-follow on for this one attempt.
    confirmationLinkPattern: ["https?://(?:www\\.)?(?:x|twitter)\\.com/\\S*(?:confirm|verify)\\S*", "i"],
    steps: [
      {
        title: "Create your X account",
        humanAction: "captcha",
        body: [
          "If you don't already have an X account for this business, go to x.com and sign up.",
          "Pick a handle and name that match what you want to post as — Jarvis can suggest bio copy once the account exists, but the account itself has to be created by hand.",
          "Verify with an email address rather than a phone number if X offers the choice, and use one on a domain you've connected to Jarvis's Resend inbound — that's what lets the next step happen automatically.",
          "X will very likely show a CAPTCHA or similar human-verification step here. That part needs you — it exists specifically to stop this kind of automation.",
        ],
        linkUrl: "https://x.com/signup",
        linkLabel: "Open X signup",
      },
      {
        title: "Confirm your email",
        humanAction: "email_confirm",
        body: [
          "X emails a confirmation link (or code) to finish activating the account.",
          "Once Jarvis detects it, the link is surfaced here — click it yourself unless you've explicitly turned on auto-follow for this signup.",
        ],
      },
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
          title: `Have a ${input.accountLabel.toLowerCase()} ready`,
          body: [
            input.id === "facebook"
              ? "Facebook Pages are created from an existing personal Facebook account, not signed up for on their own — if you don't have one yet, create it from Meta's Pages tool."
              : "An Instagram professional account is switched over from an existing Instagram account, not signed up for on its own — if you don't have one yet, create a normal account in the Instagram app first, then convert it in Settings.",
            "Meta scrutinizes newly created accounts and Pages closely, so this one step deliberately stays entirely manual — no guided signup, no email-confirmation detection here.",
          ],
        },
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

const push: Platform = {
  definition: {
    id: "push",
    name: "Push notifications",
    tagline: "Get approvals and alerts on your phone the moment they happen.",
    category: "notifications",
    docsUrl: "https://pushover.net/apps/build",
    fields: [
      {
        key: "userKey",
        label: "User Key",
        help: "Shown on your Pushover dashboard once you're signed in.",
        placeholder: "u1a2b3c4d5e6f7g8h9i0j1k2l3m4n5",
        secret: true,
      },
      {
        key: "apiToken",
        label: "Application API Token",
        help: "Create an application named Jarvis at pushover.net/apps/build, then copy its API token.",
        placeholder: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5",
        secret: true,
      },
    ],
    capabilities: ["Push notifications", "One-tap approve from the notification"],
    dataFreshness: "Real-time",
    steps: [
      {
        title: "Install Pushover",
        body: [
          "Install the Pushover app on your phone and create an account — a small one-time purchase per platform, no subscription.",
          "Copy your User Key from the Pushover dashboard.",
        ],
        linkUrl: "https://pushover.net",
        linkLabel: "Open Pushover",
      },
      {
        title: "Create an application",
        body: [
          "Go to Apps & Plugins → Create an Application/API Token, name it Jarvis, and create it.",
          "Copy the API Token it shows you.",
        ],
        linkUrl: "https://pushover.net/apps/build",
        linkLabel: "Create a Pushover application",
      },
    ],
  },
  async test(creds) {
    const { status, body } = await fetchJson("https://api.pushover.net/1/users/validate.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: creds.apiToken, user: creds.userKey }).toString(),
    });
    const data = body as { status?: number; errors?: string[] };
    if (status !== 200 || data?.status !== 1) {
      return failure(`Pushover rejected the credentials: ${data?.errors?.join(", ") ?? `HTTP ${status}`}`);
    }
    return { ok: true, detail: "Connected — Jarvis can send push notifications" };
  },
};

const stripe: Platform = {
  definition: {
    id: "stripe",
    name: "Stripe",
    tagline: "Fund a virtual card per biller — Anthropic Console, ad platforms — from your Stripe balance.",
    category: "finance",
    docsUrl: "https://dashboard.stripe.com/apikeys",
    fields: [
      {
        key: "secretKey",
        label: "Restricted API Key",
        help: "Create one at Developers → API keys → Create restricted key, with read/write on Issuing and read on Balance. Not your full secret key — a restricted one scoped to only what Jarvis needs.",
        expectedPrefix: "rk_",
        placeholder: "rk_…",
        secret: true,
      },
      {
        key: "publishableKey",
        label: "Publishable Key",
        help: "From the same API keys page. Safe to be non-secret — it's what reveals a card's number in your browser without ever passing through Jarvis.",
        expectedPrefix: "pk_",
        placeholder: "pk_…",
        secret: false,
      },
      {
        key: "cardholderId",
        label: "Cardholder ID",
        help: "Create a Cardholder yourself under Issuing → Cardholders in the Stripe Dashboard — this needs identity details (name, date of birth, address) Jarvis deliberately never collects — then paste its ich_… id here.",
        expectedPrefix: "ich_",
        placeholder: "ich_…",
        secret: false,
      },
    ],
    capabilities: ["Per-biller virtual cards", "Spend limits enforced by Stripe, not Jarvis", "PAN reveal never touches Jarvis"],
    dataFreshness: "Real-time",
    steps: [
      {
        title: "Create a restricted API key",
        body: [
          "In the Stripe Dashboard, go to Developers → API keys → Create restricted key.",
          "Grant Write access to Issuing and Read access to Balance. Nothing else.",
        ],
        linkUrl: "https://dashboard.stripe.com/apikeys",
        linkLabel: "Open Stripe API keys",
      },
      {
        title: "Create a Cardholder",
        body: [
          "Under Issuing → Cardholders, create one for yourself — this is the one step Jarvis can't do for you, since it needs identity details for card-network compliance.",
          "Copy its ich_… id below once it's active.",
        ],
        linkUrl: "https://dashboard.stripe.com/issuing/cardholders",
        linkLabel: "Open Stripe Cardholders",
      },
      {
        title: "Fund your balance",
        body: [
          "However you choose to fund it — bank transfer, Stripe's crypto onramp, or anything else Stripe offers for your account — Jarvis only ever reads the resulting balance and issues cards against it. It never initiates a transfer itself.",
          "Stablecoin-backed cards specifically (funding a balance directly with crypto that stays crypto until spent) is a separate Stripe product still in private preview and gated behind a Connect-platform setup — contact Stripe directly if that specific shape matters to you. This integration works the same either way once a balance exists.",
        ],
        warning: "None of this — funding, KYC, compliance — is something Jarvis automates. It only ever reads balance and manages cards once the account itself is ready.",
      },
    ],
  },
  async test(creds) {
    const client = new Stripe(creds.secretKey);
    try {
      const [balance, cardholder] = await Promise.all([
        client.balance.retrieve(),
        client.issuing.cardholders.retrieve(creds.cardholderId),
      ]);
      const issuingAvailable = balance.issuing?.available ?? [];
      const summary = issuingAvailable.length
        ? issuingAvailable.map((b) => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(", ")
        : "0.00";
      return {
        ok: true,
        detail: `Connected — Issuing balance ${summary}, cardholder ${cardholder.name} (${cardholder.status})`,
      };
    } catch (err) {
      return failure(err instanceof Error ? err.message : "Stripe rejected the credentials.");
    }
  },
};

const coinbase: Platform = {
  definition: {
    id: "coinbase",
    name: "Coinbase Wallet",
    tagline: "Spend USDC from your own Coinbase Smart Wallet within a bounded allowance you grant.",
    category: "finance",
    docsUrl: "https://portal.cdp.coinbase.com",
    fields: [
      {
        key: "cdpApiKeyId",
        label: "CDP API Key ID",
        help: "From the CDP Portal → API Keys. This and the two fields below identify Jarvis's own spender identity — separate from your wallet's own keys, which never leave Coinbase's infrastructure.",
        secret: true,
      },
      {
        key: "cdpApiKeySecret",
        label: "CDP API Key Secret",
        help: "Shown once when you create the API key — copy it immediately.",
        secret: true,
      },
      {
        key: "cdpWalletSecret",
        label: "CDP Wallet Secret",
        help: "Generated separately from the API key, also in the CDP Portal, under the same project.",
        secret: true,
      },
      {
        key: "operatorAddress",
        label: "Your Smart Wallet address",
        help: "The Coinbase Smart Wallet you'll grant a spend permission from — the one holding the actual USDC. Not secret; it's a public address.",
        placeholder: "0x…",
        secret: false,
      },
    ],
    capabilities: ["Bounded autonomous spend via Spend Permissions", "Keys never leave Coinbase's infrastructure", "USDC on Base"],
    dataFreshness: "Real-time",
    steps: [
      {
        title: "Create a CDP API key and Wallet Secret",
        body: [
          "In the CDP Portal, create an API key and generate a Wallet Secret under the same project.",
          "These let Jarvis's server control its own spender identity — a separate account from your own wallet, which Coinbase custodies inside a Trusted Execution Environment.",
        ],
        linkUrl: "https://portal.cdp.coinbase.com",
        linkLabel: "Open CDP Portal",
      },
      {
        title: "Save credentials, then copy Jarvis's spender address",
        body: [
          "Enter the three CDP fields below and save — Jarvis creates its spender account the first time it connects.",
          "Once connected, this page shows the spender address you'll grant a permission to in the next step.",
        ],
      },
      {
        title: "Grant a Spend Permission",
        body: [
          "Using the panel below, connect your own Coinbase Smart Wallet and set an allowance (e.g. $50/week) authorizing Jarvis's spender address specifically — not a blank check, a bounded one you can revoke or tighten anytime from your wallet.",
          "This step happens entirely in your browser, signed by your own wallet. Jarvis never sees your wallet's private key at any point.",
        ],
        warning: "Only grant what you're comfortable Jarvis spending autonomously within — the on-chain contract enforces the limit, not Jarvis's own judgment.",
      },
    ],
  },
  async test(creds) {
    try {
      const cdp = new CdpClient({
        apiKeyId: creds.cdpApiKeyId,
        apiKeySecret: creds.cdpApiKeySecret,
        walletSecret: creds.cdpWalletSecret,
      });
      const spender = await cdp.evm.getOrCreateAccount({ name: "jarvis-spender" });
      return { ok: true, detail: `Connected — Jarvis's spender address is ${spender.address}` };
    } catch (err) {
      return failure(err instanceof Error ? err.message : "Coinbase rejected the credentials.");
    }
  },
};

export const PLATFORMS: Platform[] = [x, facebook, instagram, slack, discord, resend, googleAds, metaAds, xAds, push, stripe, coinbase];

export function getPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.definition.id === id);
}

export function platformDefinitions(): PlatformDefinition[] {
  return PLATFORMS.map((p) => p.definition);
}
