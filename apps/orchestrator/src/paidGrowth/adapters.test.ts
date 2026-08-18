import { describe, expect, it } from "vitest";
import { parseGoogleAdsPerformance, parseMetaAdsPerformance, parseXAdsPerformance } from "./adapters.js";

describe("paid growth reporting adapters", () => {
  it("normalizes Google micros and conversion value", () => {
    expect(parseGoogleAdsPerformance({ results: [{ metrics: { costMicros: "1250000", impressions: "1000", clicks: "50", conversions: 4, conversionsValue: 375 } }] })).toEqual({
      spentMinor: 125,
      revenueMinor: 37_500,
      impressions: 1_000,
      clicks: 50,
      conversions: 4,
    });
  });

  it("prefers Meta purchase attribution without double counting aliases", () => {
    expect(parseMetaAdsPerformance({ data: [{ spend: "12.50", impressions: "800", clicks: "32", actions: [{ action_type: "purchase", value: "3" }, { action_type: "omni_purchase", value: "3" }], action_values: [{ action_type: "purchase", value: "99.95" }] }] })).toEqual({
      spentMinor: 1_250,
      revenueMinor: 9_995,
      impressions: 800,
      clicks: 32,
      conversions: 3,
    });
  });

  it("sums X metric arrays and preserves separately attributed revenue", () => {
    expect(parseXAdsPerformance({ data: [{ id_data: [{ metrics: { billed_charge_local_micro: [1_000_000, 500_000], impressions: [90, 10], clicks: [4, 1], conversion_purchases: [2], conversion_sign_ups: [1] } }] }] }, 4_200)).toEqual({
      spentMinor: 150,
      revenueMinor: 4_200,
      impressions: 100,
      clicks: 5,
      conversions: 3,
    });
  });
});
