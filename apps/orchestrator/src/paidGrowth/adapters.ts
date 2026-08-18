import type { PaidGrowthCampaignRecord, UpdatePaidGrowthPerformanceRequest } from "@jarvis/shared";
import { getConnectionCredentials } from "../db/connectionsRepo.js";
import { oauth1Header } from "../platforms/oauth1.js";

type Credentials = Record<string, string>;

export interface PaidGrowthSyncResult {
  performance: UpdatePaidGrowthPerformanceRequest;
  mode: "replace" | "increment";
  window: { start: string; end: string };
}

async function jsonRequest(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function requireCredentials(platform: PaidGrowthCampaignRecord["platform"]): Credentials {
  const credentials = getConnectionCredentials(platform);
  if (!credentials) throw new Error(`No ${platform} credentials are stored`);
  return credentials;
}

function finiteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(values: unknown): number {
  return Array.isArray(values) ? values.reduce<number>((total, value) => total + finiteNumber(value), 0) : finiteNumber(values);
}

function majorToMinor(value: unknown): number {
  return Math.max(0, Math.round(finiteNumber(value) * 100));
}

function microsToMinor(value: unknown): number {
  return Math.max(0, Math.round(finiteNumber(value) / 10_000));
}

export function parseGoogleAdsPerformance(body: unknown): UpdatePaidGrowthPerformanceRequest {
  const rows = (body as { results?: Array<{ metrics?: Record<string, unknown> }> } | null)?.results ?? [];
  return rows.reduce<UpdatePaidGrowthPerformanceRequest>((totals, row) => {
    const metrics = row.metrics ?? {};
    totals.spentMinor += microsToMinor(metrics.costMicros);
    totals.revenueMinor += majorToMinor(metrics.conversionsValue);
    totals.impressions += Math.round(finiteNumber(metrics.impressions));
    totals.clicks += Math.round(finiteNumber(metrics.clicks));
    totals.conversions += Math.round(finiteNumber(metrics.conversions));
    return totals;
  }, { spentMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0 });
}

type MetaAction = { action_type?: string; value?: string | number };
const META_PURCHASE_ACTIONS = new Set(["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
const META_LEAD_ACTIONS = new Set(["lead", "omni_lead", "offsite_conversion.fb_pixel_lead"]);

function preferredMetaActionValue(actions: MetaAction[] | undefined): number {
  const purchases = (actions ?? []).filter((action) => META_PURCHASE_ACTIONS.has(action.action_type ?? ""));
  if (purchases.length) return Math.max(...purchases.map((action) => finiteNumber(action.value)));
  const leads = (actions ?? []).filter((action) => META_LEAD_ACTIONS.has(action.action_type ?? ""));
  return leads.length ? Math.max(...leads.map((action) => finiteNumber(action.value))) : 0;
}

export function parseMetaAdsPerformance(body: unknown): UpdatePaidGrowthPerformanceRequest {
  const rows = (body as { data?: Array<{ spend?: string; impressions?: string; clicks?: string; actions?: MetaAction[]; action_values?: MetaAction[] }> } | null)?.data ?? [];
  return rows.reduce<UpdatePaidGrowthPerformanceRequest>((totals, row) => {
    totals.spentMinor += majorToMinor(row.spend);
    totals.revenueMinor += majorToMinor(preferredMetaActionValue(row.action_values));
    totals.impressions += Math.round(finiteNumber(row.impressions));
    totals.clicks += Math.round(finiteNumber(row.clicks));
    totals.conversions += Math.round(preferredMetaActionValue(row.actions));
    return totals;
  }, { spentMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0 });
}

const X_CONVERSION_METRICS = [
  "conversion_custom",
  "conversion_site_visits",
  "conversion_sign_ups",
  "conversion_downloads",
  "conversion_purchases",
];

export function parseXAdsPerformance(body: unknown, existingRevenueMinor = 0): UpdatePaidGrowthPerformanceRequest {
  const entries = (body as { data?: Array<{ id_data?: Array<{ metrics?: Record<string, unknown> }> }> } | null)?.data ?? [];
  const totals: UpdatePaidGrowthPerformanceRequest = {
    spentMinor: 0,
    revenueMinor: existingRevenueMinor,
    impressions: 0,
    clicks: 0,
    conversions: 0,
  };
  for (const entry of entries) {
    for (const series of entry.id_data ?? []) {
      const metrics = series.metrics ?? {};
      totals.spentMinor += microsToMinor(sum(metrics.billed_charge_local_micro));
      totals.impressions += Math.round(sum(metrics.impressions));
      totals.clicks += Math.round(sum(metrics.clicks));
      totals.conversions += Math.round(X_CONVERSION_METRICS.reduce((count, key) => count + sum(metrics[key]), 0));
    }
  }
  return totals;
}

async function googlePerformance(campaign: PaidGrowthCampaignRecord, credentials: Credentials): Promise<PaidGrowthSyncResult> {
  const token = await jsonRequest("https://www.googleapis.com/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    }).toString(),
  });
  const accessToken = (token.body as { access_token?: string } | null)?.access_token;
  if (token.status !== 200 || !accessToken) throw new Error("Google Ads rejected the stored OAuth credentials");
  const customerId = credentials.customerId.replace(/-/g, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": credentials.developerToken,
    "Content-Type": "application/json",
  };
  if (credentials.loginCustomerId) headers["login-customer-id"] = credentials.loginCustomerId.replace(/-/g, "");
  const result = await jsonRequest(`https://googleads.googleapis.com/v25/customers/${encodeURIComponent(customerId)}/googleAds:search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.id = ${campaign.externalCampaignId} AND segments.date BETWEEN '${campaign.startDate}' AND '${new Date().toISOString().slice(0, 10)}'`,
    }),
  });
  if (result.status !== 200) throw new Error(`Google Ads performance sync failed (HTTP ${result.status})`);
  return {
    performance: parseGoogleAdsPerformance(result.body),
    mode: "replace",
    window: { start: campaign.startDate, end: new Date().toISOString().slice(0, 10) },
  };
}

async function metaPerformance(campaign: PaidGrowthCampaignRecord, credentials: Credentials): Promise<PaidGrowthSyncResult> {
  const end = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    fields: "spend,impressions,clicks,actions,action_values",
    time_range: JSON.stringify({ since: campaign.startDate, until: end }),
    level: "campaign",
  });
  const result = await jsonRequest(`https://graph.facebook.com/v24.0/${encodeURIComponent(campaign.externalCampaignId!)}/insights?${params}`, {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  });
  if (result.status !== 200) throw new Error(`Meta Ads performance sync failed (HTTP ${result.status})`);
  return {
    performance: parseMetaAdsPerformance(result.body),
    mode: "replace",
    window: { start: campaign.startDate, end },
  };
}

function wholeHour(date: Date): string {
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString().replace(".000Z", "Z");
}

async function xPerformance(campaign: PaidGrowthCampaignRecord, credentials: Credentials): Promise<PaidGrowthSyncResult> {
  // X's synchronous endpoint only permits seven days. After the first baseline,
  // request only complete hours since the previous sync and add that delta to
  // the durable lifetime ledger. This avoids silently replacing lifetime data
  // with a smaller rolling window.
  const end = new Date();
  end.setUTCMinutes(0, 0, 0);
  const earliest = new Date(end);
  earliest.setUTCDate(earliest.getUTCDate() - 7);
  const campaignStart = new Date(`${campaign.startDate}T00:00:00Z`);
  const previousSync = campaign.lastSyncedAt ? new Date(campaign.lastSyncedAt) : null;
  if (previousSync) previousSync.setUTCMinutes(0, 0, 0);
  const start = previousSync ?? (campaignStart > earliest ? campaignStart : earliest);
  const mode = previousSync ? "increment" : "replace";
  if (start >= end) {
    return {
      performance: { spentMinor: 0, revenueMinor: campaign.revenueMinor, impressions: 0, clicks: 0, conversions: 0 },
      mode,
      window: { start: wholeHour(start), end: wholeHour(end) },
    };
  }
  const url = `https://ads-api.x.com/12/stats/accounts/${encodeURIComponent(credentials.accountId)}`;
  const params: Record<string, string> = {
    entity: "CAMPAIGN",
    entity_ids: campaign.externalCampaignId!,
    start_time: wholeHour(start),
    end_time: wholeHour(end),
    granularity: "TOTAL",
    placement: "ALL_ON_TWITTER",
    metric_groups: "ENGAGEMENT,BILLING,WEB_CONVERSION",
  };
  const query = new URLSearchParams(params).toString();
  const authorization = oauth1Header("GET", url, {
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    accessToken: credentials.accessToken,
    accessTokenSecret: credentials.accessTokenSecret,
  }, params);
  const result = await jsonRequest(`${url}?${query}`, { headers: { Authorization: authorization } });
  if (result.status !== 200) throw new Error(`X Ads performance sync failed (HTTP ${result.status})`);
  return {
    performance: parseXAdsPerformance(result.body, campaign.revenueMinor),
    mode,
    window: { start: wholeHour(start), end: wholeHour(end) },
  };
}

export async function syncPaidGrowthPerformance(campaign: PaidGrowthCampaignRecord): Promise<PaidGrowthSyncResult> {
  if (!campaign.externalCampaignId) throw new Error("Link a platform campaign ID before syncing performance");
  const credentials = requireCredentials(campaign.platform);
  if (campaign.platform === "google_ads") return googlePerformance(campaign, credentials);
  if (campaign.platform === "meta_ads") return metaPerformance(campaign, credentials);
  return xPerformance(campaign, credentials);
}
