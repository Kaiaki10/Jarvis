import type { PaidGrowthCampaignRecord } from "@jarvis/shared";
import { getConnectionCredentials } from "../db/connectionsRepo.js";
import { oauth1Header } from "../platforms/oauth1.js";

type Credentials = Record<string, string>;
export interface PaidGrowthPlatformAction {
  dailyBudgetMinor?: number;
  status?: "active" | "paused";
}

async function request(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* Some successful mutations have no useful JSON body. */ }
  return { status: response.status, body };
}

function assertOk(platform: string, operation: string, result: { status: number }) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${platform} rejected the ${operation} (HTTP ${result.status})`);
  }
}

async function googleAccessToken(credentials: Credentials): Promise<string> {
  const result = await request("https://www.googleapis.com/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    }).toString(),
  });
  const token = (result.body as { access_token?: string } | null)?.access_token;
  if (result.status !== 200 || !token) throw new Error("Google Ads rejected the stored OAuth credentials");
  return token;
}

async function executeGoogle(campaign: PaidGrowthCampaignRecord, action: PaidGrowthPlatformAction, credentials: Credentials) {
  const token = await googleAccessToken(credentials);
  const customerId = credentials.customerId.replace(/-/g, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": credentials.developerToken,
    "Content-Type": "application/json",
  };
  if (credentials.loginCustomerId) headers["login-customer-id"] = credentials.loginCustomerId.replace(/-/g, "");
  const root = `https://googleads.googleapis.com/v25/customers/${encodeURIComponent(customerId)}`;

  if (action.dailyBudgetMinor !== undefined) {
    const lookup = await request(`${root}/googleAds:search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: `SELECT campaign.campaign_budget, campaign_budget.resource_name, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campaign.externalCampaignId} LIMIT 1` }),
    });
    assertOk("Google Ads", "campaign budget lookup", lookup);
    const row = (lookup.body as { results?: Array<{ campaign?: { campaignBudget?: string }; campaignBudget?: { resourceName?: string; explicitlyShared?: boolean } }> } | null)?.results?.[0];
    const resourceName = row?.campaignBudget?.resourceName ?? row?.campaign?.campaignBudget;
    if (!resourceName) throw new Error("Google Ads did not return a campaign budget for this campaign");
    if (row?.campaignBudget?.explicitlyShared) throw new Error("This Google campaign uses a shared budget. Give it a dedicated budget before Jarvis manages it.");
    const mutation = await request(`${root}/campaignBudgets:mutate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ operations: [{ update: { resourceName, amountMicros: String(action.dailyBudgetMinor * 10_000) }, updateMask: "amount_micros" }] }),
    });
    assertOk("Google Ads", "daily budget change", mutation);
  }

  if (action.status) {
    const resourceName = `customers/${customerId}/campaigns/${campaign.externalCampaignId}`;
    const mutation = await request(`${root}/campaigns:mutate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ operations: [{ update: { resourceName, status: action.status === "active" ? "ENABLED" : "PAUSED" }, updateMask: "status" }] }),
    });
    assertOk("Google Ads", `${action.status} status change`, mutation);
  }
}

async function metaMutation(entityId: string, values: Record<string, string>, credentials: Credentials, operation: string) {
  const result = await request(`https://graph.facebook.com/v24.0/${encodeURIComponent(entityId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  });
  assertOk("Meta Ads", operation, result);
}

async function executeMeta(campaign: PaidGrowthCampaignRecord, action: PaidGrowthPlatformAction, credentials: Credentials) {
  if (action.dailyBudgetMinor !== undefined) {
    await metaMutation(
      campaign.externalBudgetEntityId ?? campaign.externalCampaignId!,
      { daily_budget: String(action.dailyBudgetMinor) },
      credentials,
      "daily budget change",
    );
  }
  if (action.status) {
    await metaMutation(campaign.externalCampaignId!, { status: action.status === "active" ? "ACTIVE" : "PAUSED" }, credentials, `${action.status} status change`);
  }
}

async function executeX(campaign: PaidGrowthCampaignRecord, action: PaidGrowthPlatformAction, credentials: Credentials) {
  const url = `https://ads-api.x.com/12/accounts/${encodeURIComponent(credentials.accountId)}/campaigns/${encodeURIComponent(campaign.externalCampaignId!)}`;
  const values: Record<string, string> = {};
  if (action.dailyBudgetMinor !== undefined) values.daily_budget_amount_local_micro = String(action.dailyBudgetMinor * 10_000);
  if (action.status) values.entity_status = action.status === "active" ? "ACTIVE" : "PAUSED";
  const authorization = oauth1Header("PUT", url, {
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    accessToken: credentials.accessToken,
    accessTokenSecret: credentials.accessTokenSecret,
  }, values);
  const result = await request(`${url}?${new URLSearchParams(values)}`, { method: "PUT", headers: { Authorization: authorization } });
  assertOk("X Ads", "campaign change", result);
}

export async function executePaidGrowthActionWithCredentials(campaign: PaidGrowthCampaignRecord, action: PaidGrowthPlatformAction, credentials: Credentials) {
  if (!campaign.externalCampaignId) throw new Error("Link a platform campaign ID before applying a paid-growth decision");
  if (action.dailyBudgetMinor === undefined && !action.status) throw new Error("No platform change was requested");
  if (campaign.platform === "google_ads") return executeGoogle(campaign, action, credentials);
  if (campaign.platform === "meta_ads") return executeMeta(campaign, action, credentials);
  return executeX(campaign, action, credentials);
}

export async function executePaidGrowthAction(campaign: PaidGrowthCampaignRecord, action: PaidGrowthPlatformAction) {
  const credentials = getConnectionCredentials(campaign.platform);
  if (!credentials) throw new Error(`No ${campaign.platform} credentials are stored`);
  return executePaidGrowthActionWithCredentials(campaign, action, credentials);
}
